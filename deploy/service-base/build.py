"""Build an immutable plugin package without credentials, tests or runtime data."""
import argparse
import json
from pathlib import Path
import shutil

ROOT=Path(__file__).resolve().parents[2]

def build(output,overrides):
    output=output.resolve()
    if output==ROOT or ROOT.is_relative_to(output):raise ValueError('Output cannot contain the source checkout')
    if output.exists():
        if not (output/'.forma-plugin-build').is_file():raise ValueError('Refusing to replace an unrelated directory')
        shutil.rmtree(output)
    output.mkdir(parents=True);(output/'.forma-plugin-build').touch()
    manifest=json.loads((ROOT/'deploy/service-base/plugin.json').read_text())
    manifest['config'].update({key:value for key,value in overrides.items() if value is not None})
    (output/'plugin.json').write_text(json.dumps(manifest,indent=2)+'\n')
    shutil.copy2(ROOT/'deploy/service-base/main.py',output/'main.py')
    ignore=shutil.ignore_patterns('__pycache__','*.pyc','tests')
    shutil.copytree(ROOT/'backend',output/'app/backend',ignore=ignore)
    (output/'app/frontend').mkdir(parents=True)
    for name in ('index.html','workbench.html','src','assets'):
        source=ROOT/'frontend'/name;target=output/'app/frontend'/name
        if source.is_dir():shutil.copytree(source,target)
        else:shutil.copy2(source,target)
    return output

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',type=Path,default=ROOT/'build/service-base')
    for key in ('env-file','database','public-url','frpc-binary','frpc-config'):parser.add_argument('--'+key)
    args=vars(parser.parse_args());output=args.pop('output')
    print(build(output,args))
