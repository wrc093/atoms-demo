import socket
import unittest
from unittest.mock import patch
from backend.providers import ProviderError, PinnedHTTPS, public_addresses, request_user_model


class UserProviderTest(unittest.TestCase):
    def test_rejects_private_and_mixed_dns_answers(self):
        for addresses in [('127.0.0.1',),('10.0.0.8',),('169.254.169.254',),('::1',),('8.8.8.8','192.168.1.1')]:
            with self.subTest(addresses=addresses),patch('backend.providers.socket.getaddrinfo',return_value=[(socket.AF_INET,socket.SOCK_STREAM,6,'',(ip,443)) for ip in addresses]):
                with self.assertRaises(ProviderError):public_addresses('provider.example.test',443)

    def test_fake_ip_dns_is_resolved_and_still_rejects_private_answers(self):
        records=[(socket.AF_INET,socket.SOCK_STREAM,6,'',('198.18.0.25',443))]
        with patch('backend.providers.socket.getaddrinfo',return_value=records),patch('backend.providers.resolve_proxy_dns',return_value=['8.8.8.8']):
            self.assertEqual(public_addresses('provider.example.test',443),['8.8.8.8'])
        with patch('backend.providers.socket.getaddrinfo',return_value=records),patch('backend.providers.resolve_proxy_dns',return_value=['192.168.1.10']):
            with self.assertRaises(ProviderError):public_addresses('provider.example.test',443)

    def test_http_proxy_tunnels_to_public_ip_with_original_tls_hostname(self):
        with patch('backend.providers.urllib.request.getproxies',return_value={'https':'http://127.0.0.1:7897'}),patch('backend.providers.socket.create_connection') as create,patch.object(PinnedHTTPS,'_tunnel') as tunnel,patch('backend.providers.ssl.create_default_context') as context:
            connection=PinnedHTTPS('provider.example.test',443,'8.8.8.8')
            connection.connect()
            create.assert_called_once_with(('127.0.0.1',7897),120)
            self.assertEqual(connection._tunnel_host,'8.8.8.8');tunnel.assert_called_once()
            context.return_value.wrap_socket.assert_called_once_with(create.return_value,server_hostname='provider.example.test')
            connection.close()

    def test_transport_pins_validated_ip_and_refuses_redirects(self):
        with patch('backend.providers.public_addresses',return_value=['8.8.8.8']),patch('backend.providers.PinnedHTTPS') as connection:
            response=connection.return_value.getresponse.return_value;response.status=302
            with self.assertRaises(ProviderError) as caught:
                request_user_model('https://provider.example.test/v1/chat/completions',{'model':'test'},'test-secret-key')
            connection.assert_called_once_with('provider.example.test',443,'8.8.8.8')
            self.assertNotIn('test-secret-key',str(caught.exception))
            connection.return_value.request.assert_called_once()
            connection.return_value.close.assert_called_once()
