#!/usr/bin/env python3
"""Deterministic SVG build. Python >=3.9, standard library only; no network/fonts/raster input."""
from pathlib import Path
import json, hashlib, argparse
from xml.sax.saxutils import escape
ROOT=Path(__file__).resolve().parent.parent
SRC=ROOT/'source'
C=json.loads((SRC/'tokens.json').read_text())['colors']
S=json.loads((SRC/'symbol.json').read_text())

def group(data,ink,accent,transform='',prefix=''):
    attrs=f' transform="{transform}"' if transform else ''
    result=[f'<g{attrs}>']
    for i,p in enumerate(data['paths']):
        color=accent if p['role']=='accent' else ink
        result.append(f'<path id="{prefix}{p.get("id",str(i))}" fill="{color}" fill-rule="evenodd" d="{p["d"]}"/>')
    return '\n'.join(result+['</g>'])

def document(w,h,body,title):
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title desc">
<title id="title">{escape(title)}</title>
<desc id="desc">OpenVibeDesk. Vector reconstruction from supplied visual reference, version 1.0. All artwork is outlined; no embedded bitmap or font dependency.</desc>
{body}
</svg>
'''

def build(out):
    out.mkdir(parents=True,exist_ok=True)
    W=json.loads((SRC/'wordmark.json').read_text())
    manifest={}
    def save(name,w,h,body,title):
        data=document(w,h,body,title)
        (out/name).write_text(data,encoding='utf-8')
        manifest[name]=hashlib.sha256(data.encode()).hexdigest()
    styles={'primary':(C['navy'],C['violet']), 'inverse':(C['white'],C['inverse-accent']), 'mono-navy':(C['navy'],C['navy']), 'mono-white':(C['white'],C['white'])}
    for variant,(ink,accent) in styles.items():
        save(f'ovd-symbol-{variant}.svg',717,266,group(S,ink,accent,prefix='s-'),f'OpenVibeDesk symbol, {variant}')
        save(f'ovd-wordmark-{variant}.svg',866,122,group(W,ink,accent,prefix='w-'),f'OpenVibeDesk wordmark, {variant}')
        save(f'ovd-logo-{variant}.svg',866,418,group(S,ink,accent,'translate(75 0)','s-')+'\n'+group(W,ink,accent,'translate(0 296)','w-'),f'OpenVibeDesk primary lockup, {variant}')
        save(f'ovd-horizontal-{variant}.svg',1356,160,group(S,ink,accent,'scale(0.6)','s-')+'\n'+group(W,ink,accent,'translate(490 19)','w-'),f'OpenVibeDesk horizontal lockup, {variant}')
    for variant,bg,ink,accent in [('violet',C['violet'],C['white'],C['white']),('navy',C['navy'],C['white'],C['inverse-accent']),('light',C['white'],C['navy'],C['violet']),('lavender',C['lavender'],C['navy'],C['violet'])]:
        scale=388/717
        top=(512-266*scale)/2
        body=f'<rect width="512" height="512" rx="112" fill="{bg}"/>\n'+group(S,ink,accent,f'translate(62 {top:.6f}) scale({scale:.9f})','s-')
        save(f'ovd-app-{variant}.svg',512,512,body,f'OpenVibeDesk app icon, {variant}')
    (out/'SHA256SUMS.txt').write_text(''.join(f'{sha}  {name}\n' for name,sha in sorted(manifest.items())))
    css='/* OpenVibeDesk CI 1.0 - sRGB */\n:root {\n'+''.join(f'  --ovd-{k}: {v};\n' for k,v in C.items())+'  --ovd-font-family: "Manrope", system-ui, sans-serif;\n}\n'
    (out/'ovd-tokens.css').write_text(css)
    print(f'{len(manifest)} SVGs generated in {out}')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--out',type=Path,default=ROOT/'assets');args=parser.parse_args();build(args.out)
