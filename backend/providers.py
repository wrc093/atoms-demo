"""User-supplied provider connections. Credentials stay in process memory."""
import http.client
import ipaddress
import json
import socket
import ssl
import urllib.request
from urllib.parse import urlsplit, urlencode


class ProviderError(ValueError):
    pass


def resolve_proxy_dns(host):
    """TUN fake-IP answers must be resolved independently, never treated as public."""
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs): return None
    addresses = []
    try:
        for kind in ("A", "AAAA"):
            url = "https://cloudflare-dns.com/dns-query?" + urlencode({"name":host,"type":kind})
            request = urllib.request.Request(url, headers={"Accept":"application/dns-json"})
            with urllib.request.build_opener(NoRedirect).open(request, timeout=8) as response:
                raw = response.read(65537)
                if len(raw) > 65536: raise ValueError()
                data = json.loads(raw)
            addresses.extend(item["data"] for item in data.get("Answer", []) if item.get("type") in (1,28))
    except (OSError, ValueError, KeyError):
        raise ProviderError("代理环境下无法校验模型服务的公网地址，请检查网络后重试") from None
    return list(dict.fromkeys(addresses))


def public_addresses(host, port):
    try:
        addresses = list(dict.fromkeys(item[4][0] for item in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)))
    except OSError:
        raise ProviderError("无法解析模型服务地址，请检查 Base URL") from None
    fake_ranges = (ipaddress.ip_network("198.18.0.0/15"), ipaddress.ip_network("fdfe:dcba:9876::/48"))
    if addresses and all(any(ipaddress.ip_address(address) in network for network in fake_ranges) for address in addresses):
        addresses = resolve_proxy_dns(host)
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise ProviderError("模型服务需要使用公网 HTTPS 地址，不支持本机或内网地址")
    return addresses


def parse_endpoint(value):
    if not isinstance(value, str) or len(value) > 512 or any(ord(char) <= 32 for char in value):
        raise ProviderError("请填写有效的 HTTPS Base URL")
    try:
        parsed = urlsplit(value)
        port = parsed.port or 443
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError()
    except ValueError:
        raise ProviderError("Base URL 需要是 HTTPS 地址，不能包含账号、密码或查询参数") from None
    return parsed, port


def user_config(data, previous=None):
    base = data.get("baseUrl", "")
    parsed, port = parse_endpoint(base)
    public_addresses(parsed.hostname, port)
    model, api = data.get("model"), data.get("api", "chat_completions")
    if not isinstance(model, str) or not 1 <= len(model.strip()) <= 160 or any(ord(char) < 33 for char in model.strip()):
        raise ProviderError("请填写有效的模型名称")
    if api not in ("chat_completions", "responses"):
        raise ProviderError("请选择支持的模型协议")
    base = base.rstrip("/")
    key = data.get("apiKey")
    if not key and previous and previous["base_url"] == base:
        key = previous["key"]
    if not isinstance(key, str) or not 8 <= len(key.strip()) <= 4096 or any(not 33 <= ord(char) <= 126 for char in key.strip()):
        raise ProviderError("请填写有效的 API Key；更换服务地址时需要重新填写")
    return {"key":key.strip(), "base_url":base, "model":model.strip(), "api":api, "user_supplied":True}


class PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, host, port, address):
        super().__init__(host, port, timeout=120, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        # Connect to the validated IP while retaining hostname certificate checks/SNI.
        proxy = urlsplit(urllib.request.getproxies().get("https", ""))
        if proxy.scheme == "http" and proxy.hostname:
            headers = {}
            if proxy.username:
                import base64
                from urllib.parse import unquote
                credentials = unquote(proxy.username)+":"+unquote(proxy.password or "")
                headers["Proxy-Authorization"] = "Basic "+base64.b64encode(credentials.encode()).decode()
            self.set_tunnel(self.address, self.port, headers=headers)
            self.sock = socket.create_connection((proxy.hostname, proxy.port or 80), self.timeout)
            try: self._tunnel()
            except Exception:
                self.sock.close()
                raise
            raw = self.sock
        else:
            raw = socket.create_connection((self.address, self.port), self.timeout)
        try:
            self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
        except Exception:
            raw.close()
            raise


def request_user_model(endpoint, body, key):
    parsed, port = parse_endpoint(endpoint)
    addresses = public_addresses(parsed.hostname, port)
    connection = PinnedHTTPS(parsed.hostname, port, addresses[0])
    try:
        hostname = "["+parsed.hostname+"]" if ":" in parsed.hostname else parsed.hostname
        authority = hostname if port == 443 else hostname+":"+str(port)
        connection.request("POST", parsed.path or "/", body=json.dumps(body, ensure_ascii=False).encode(), headers={"Authorization":"Bearer "+key,"Content-Type":"application/json","Host":authority})
        response = connection.getresponse()
        # No redirects: never send the key to a destination selected by a response.
        if response.status != 200:
            raise ProviderError(f"你的模型服务返回 HTTP {response.status}，请检查 Key、模型名称或额度")
        raw = response.read(3_000_001)
        if len(raw) > 3_000_000:
            raise ProviderError("模型输出过大，请缩小需求")
        return raw
    except (OSError, http.client.HTTPException):
        raise ProviderError("模型连接失败或超时，请检查服务地址和网络") from None
    finally:
        connection.close()
