#!/usr/bin/env python3
"""Build the editable-source OpenVibeDesk CI PDF. See requirements.txt."""
from pathlib import Path
from io import BytesIO
import json, tempfile
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from reportlab.graphics import renderPDF
from svglib.svglib import svg2rlg
from fontTools.ttLib import TTFont as Font
from fontTools.varLib.instancer import instantiateVariableFont
import build_assets as B
ROOT=Path(__file__).resolve().parent.parent
ASSETS=ROOT/'assets'
C=B.C
PAGE_W,PAGE_H=960,680
OUT=ROOT/'OpenVibeDesk-CI.pdf'
cache=tempfile.TemporaryDirectory(prefix='ovd-ci-')
for weight in (400,500,600,700,800):
    f=Font(ROOT/'fonts/Manrope-Variable.ttf')
    instantiateVariableFont(f,{'wght':weight},inplace=True,updateFontNames=True)
    fp=Path(cache.name)/f'Manrope-{weight}.ttf';f.save(fp)
    pdfmetrics.registerFont(TTFont(f'M{weight}',str(fp)))
c=canvas.Canvas(str(OUT),pagesize=(PAGE_W,PAGE_H),pageCompression=1,invariant=1)
c.setTitle('OpenVibeDesk | Corporate Identity 1.0')
c.setAuthor('OpenVibeDesk')
c.setSubject('Visuelles CI-System und Vektorrekonstruktion aus bereitgestellter Bildvorlage')

def color(k):return HexColor(C.get(k,k))
def rect(x,y,w,h,fill,r=0,stroke=None):
    c.setFillColor(color(fill))
    if stroke:c.setStrokeColor(color(stroke));c.setLineWidth(.7)
    if r:c.roundRect(x,PAGE_H-y-h,w,h,r,fill=1,stroke=bool(stroke))
    else:c.rect(x,PAGE_H-y-h,w,h,fill=1,stroke=bool(stroke))
def line(x1,y1,x2,y2,ink='lavender',width=1,dash=None):
    c.setStrokeColor(color(ink));c.setLineWidth(width);c.setDash(dash or [])
    c.line(x1,PAGE_H-y1,x2,PAGE_H-y2);c.setDash([])
def text(s,x,y,size=12,font=400,ink='navy'):
    c.setFillColor(color(ink));c.setFont(f'M{font}' if isinstance(font,int) else font,size);c.drawString(x,PAGE_H-y-size,s)
def right(s,x,y,size=12,font=400,ink='navy'):
    c.setFillColor(color(ink));c.setFont(f'M{font}',size);c.drawRightString(x,PAGE_H-y-size,s)
def para(s,x,y,w,size=12,ink='muted',leading=None,font=400):
    st=ParagraphStyle('p',fontName=f'M{font}',fontSize=size,leading=leading or size*1.5,textColor=color(ink))
    p=Paragraph(s,st);_,h=p.wrap(w,1000);p.drawOn(c,x,PAGE_H-y-h);return h

def svg(name,x,y,w,h=None,body=None):
    d=svg2rlg(BytesIO(body.encode())) if body else svg2rlg(str(ASSETS/name))
    scale=w/d.width;dh=d.height*scale
    c.saveState();c.translate(x,PAGE_H-y-(h if h is not None else dh));c.scale(scale,(h/d.height if h is not None else scale));renderPDF.draw(d,c,0,0);c.restoreState()
    return dh

def symbol(x,y,w,style='primary'):return svg(f'ovd-symbol-{style}.svg',x,y,w)
def pill(s,x,y,w,fill='lavender',ink='navy'):
    rect(x,y,w,25,fill,12);text(s,x+11,y+6,8.5,700,ink)
def header(n,section,title,sub=None):
    rect(0,0,PAGE_W,PAGE_H,'paper')
    text('OPENVIBEDESK',56,29,9,800)
    right(f'{n:02d} / {section.upper()}',904,29,9,600,'muted')
    text(title,56,76,34,800)
    if sub:para(sub,56,127,848,12)
def footer(n,light=False):
    ink='inverse-accent' if light else 'muted'
    line(56,629,904,629,'#454B68' if light else 'lavender',.7)
    text('CORPORATE IDENTITY  /  VERSION 1.0  /  28.10.2026',56,644,8,600,ink)
    right(f'{n:02d}',904,641,11,700,'white' if light else 'navy')
    c.showPage()
def label(s,x,y):text(s,x,y,9,700,'muted')
def item(n,title,body,x,y,w=250):
    text(n,x,y,10,800,'violet');text(title,x,y+23,16,700);para(body,x,y+51,w,11.5)

# 01 - cover
rect(0,0,960,680,'paper')
text('OPENVIBEDESK / DESIGN GUIDELINES',56,34,9,800)
pill('VERSION 1.0',800,29,104)
svg('ovd-logo-primary.svg',178,124,604)
line(56,463,904,463,'lavender')
text('Corporate Identity',56,488,46,800)
text('Logo, Farbe, Schrift und Anwendung',58,554,16,500,'muted')
text('Aus der bereitgestellten Bildvorlage entwickelt.',58,588,10,400,'muted')
footer(1)

# 02 - master construction
header(2,'Logo-Master','Die Form bleibt unverwechselbar.','Die große Wort-Bild-Marke der Vorlage bildet die Grundlage aller gelieferten Varianten.')
rect(56,180,546,232,'white',18)
symbol(104,199,450)
# two annotated feature rules
text('Pupillen nach innen versetzt',80,386,10,600)
text('Freistehendes Dreieck',358,386,10,600)
text('Rekonstruktion',640,184,20,700)
para('Die Bildmarke wurde als reduzierte Bézier-Geometrie aufgebaut. Die Wortmarke wurde konturbasiert vektorisiert und geglättet.',640,220,264,12)
para('Kurven und Farben sind aus dem Rasterbild angenähert. Schattierungen und Pixelrauschen wurden in klare Volltonflächen überführt.',640,304,264,12)
item('01','Bildmarke','O, V und D bleiben in ihrer asymmetrischen Form erhalten. Das Dreieck ist ein eigener Farbakzent.',56,455,250)
item('02','Wortmarke','OpenVibeDesk wird als ein Wort geschrieben. Die gelieferte Pfadgrafik erhält Form und Laufweite.',350,455,250)
item('03','Verbindlicher Master','Kleine Varianten der Vorlage weichen voneinander ab. Hier nutzen alle Versionen dieselbe Geometrie.',644,455,260)
footer(2)

# 03 - variants
header(3,'Logo-Varianten','Ein Logo. Vier Einsatzformen.','Primärversion auf hellen Flächen; inverse und einfarbige Fassungen für andere Hintergründe.')
# top two large cards
rect(56,178,414,228,'white',16);svg('ovd-logo-primary.svg',146,199,232)
label('01  WORT-BILD-MARKE / STANDARD',76,379)
rect(490,178,414,228,'navy',16);svg('ovd-logo-inverse.svg',580,199,232)
text('02  INVERSE VERSION / DUNKLER HINTERGRUND',510,379,9,700,'white')
# bottom 4 aligned cards
xs=[56,273,490,707]
for x in xs:rect(x,426,197,143,'white',14)
svg('ovd-horizontal-primary.svg',71,475,167)
svg('ovd-wordmark-primary.svg',289,472,165)
symbol(526,456,124,'mono-navy')
rect(723,443,165,74,'violet',10);symbol(742,456,127,'mono-white')
for x,a,b in zip(xs,['HORIZONTAL','WORTMARKE','EINFARBIG NAVY','EINFARBIG WEISS'],['Breite Kopfzeilen','Kompakte Absender','Stempel und Prägung','Violette Flächen']):
    text(a,x+15,528,8.5,800);text(b,x+15,546,9,400,'muted')
para('Für kleine Flächen die Bildmarke verwenden. Eine separate Wortmarke ist sinnvoll, wenn der Markenname bereits im Fokus steht.',56,589,848,10.5)
footer(3)

# 04 - clearspace sizes
header(4,'Schutzraum & Größe','Freiraum ist Teil des Logos.','Neu definierter Standard: x entspricht dem Durchmesser einer Pupille in der jeweils skalierten Bildmarke.')
# symbol at 430 width = pupil44; external area
sx,sy,sw=105,249,430
unit=73.8*sw/717;sh=266*sw/717
rect(sx-unit,sy-unit,sw+2*unit,sh+2*unit,'lavender',3)
rect(sx,sy,sw,sh,'white')
symbol(sx,sy,sw)
for ya in [sy-unit,sy,sy+sh,sy+sh+unit]:line(sx-unit,ya,sx+sw+unit,ya,'#B7ACED',.6,[3,3])
for xx in [sx-unit,sx,sx+sw,sx+sw+unit]:line(xx,sy-unit,xx,sy+sh+unit,'#B7ACED',.6,[3,3])
text('x',sx-unit/2-3,sy+sh/2-8,14,700,'violet');text('x',sx+sw/2,sy-unit+8,14,700,'violet')
text('Mindestens 1 x rundum',105,482,18,700)
para('Keine Texte, Kanten oder anderen Bildzeichen innerhalb dieses Bereichs. Bei der Wort-Bild-Marke gilt x für die gesamte Kombination. Wortmarke allein: x = 8,52 % ihrer Breite.',105,516,435,11.5)
text('Mindestbreiten',632,186,21,700)
rows=[('Bildmarke','48 px','12 mm'),('Wort-Bild-Marke','180 px','45 mm'),('Horizontal','240 px','60 mm'),('Wortmarke','140 px','35 mm')]
text('DIGITAL',770,232,8,700,'muted');text('DRUCK',852,232,8,700,'muted')
for i,(n,d,p) in enumerate(rows):
 y=261+i*42;line(632,y+31,904,y+31,'lavender',.7);text(n,632,y,10.5,600);text(d,770,y,10.5,700);text(p,852,y,10.5,500)
para('Maße beziehen sich auf die sichtbare Grafik, ohne Schutzraum. Druckwerte sind Empfehlungen; ein Probedruck entscheidet.',632,444,272,10.5)
para('App-Kacheln: ab 64 px (Bildmarke innen ca. 49 px). Kleinere Favicons benötigen eine gesondert optimierte und geprüfte Fassung.',632,520,272,10.5)
footer(4)

# 05 - colors
header(5,'Farbsystem','Navy schafft Ruhe. Violett setzt Akzente.','Aus der Vorlage abgeleitete, vereinheitlichte sRGB-Farben. Diese Werte gelten für die gelieferten SVGs.')
colors=[('Navy','navy','34 / 40 / 68','Logo, Überschriften'),('Violet','violet','104 / 80 / 245','Akzent, primäre Aktion'),('Lavender','lavender','232 / 229 / 253','Sanfte Flächen'),('Paper','paper','249 / 249 / 254','Haupt-Hintergrund'),('White','white','255 / 255 / 255','Karten, inverse Logos')]
for i,(name,key,rgb,use) in enumerate(colors):
 x=56+i*172
 rect(x,180,160,105,key,12,stroke='lavender' if key in ('paper','white') else None)
 text(name,x,302,16,700);text(C[key],x,330,13,700);text('RGB '+rgb,x,353,9,500,'muted');text(use,x,376,9,400,'muted')
line(56,413,904,413,'lavender')
text('Lesbare Kombinationen',56,437,20,700)
combos=[('Aa','navy','white','Navy auf Weiß','14,43 : 1'),('Aa','white','violet','Weiß auf Violet','5,18 : 1'),('Aa','inverse-accent','navy','Hellviolett auf Navy','7,03 : 1')]
for i,(aa,fg,bg,desc,ratio) in enumerate(combos):
 x=56+i*177;rect(x,477,159,67,bg,10,stroke='lavender' if bg=='white' else None);text(aa,x+16,485,31,700,fg);text(ratio,x+76,505,10,600,fg);text(desc,x,552,9,600)
para('Text: Ink #12182D; sekundärer Text: #606579. Inverser Akzent: #B8AAFF. Alle sind ergänzende Systemfarben.',618,440,286,10.5)
para('Für normalen UI-Text mindestens 4,5 : 1. Violet auf Lavender erreicht nur 4,21 : 1 und ist dafür nicht vorgesehen. Logo-Farben allein belegen keine Barrierefreiheit der Anwendung.',618,501,286,10.5)
text('Druck: CMYK erst mit dem Zielprofil der Druckerei ableiten; die leuchtende Bildschirmfarbe kann abweichen.',56,595,9,400,'muted')
footer(5)

# 06 - typography
header(6,'Typografie','Geometrisch, offen, gut lesbar.','Manrope ergänzt das Logo als neu gewählte Systemschrift. Die Originalschrift der Wortmarke ist nicht sicher bestimmbar.')
rect(56,180,370,409,'navy',18)
text('Manrope',84,201,45,700,'white')
text('Aa',82,268,142,600,'white')
text('ÄÖÜ äöü ß 0123456789',86,457,20,500,'inverse-accent')
para('Regular 400 / Medium 500<br/>Semibold 600 / Bold 700 / ExtraBold 800',86,517,310,11,'white',18)
text('Digitale Schriftgrößen',466,185,21,700)
# fixed rows with specimens
text('H1',466,238,9,700,'muted');text('Klare Ideen.',520,225,34,800);text('40 / 48 px · 800',774,242,9,500,'muted')
line(466,287,904,287,'lavender',.7)
text('H2',466,315,9,700,'muted');text('Alles im Blick.',520,307,26,700);text('28 / 36 px · 700',774,320,9,500,'muted')
line(466,366,904,366,'lavender',.7)
text('TEXT',466,392,9,700,'muted');text('Klar und verständlich schreiben.',520,389,13,400);text('16 / 24 px · 400',774,394,9,500,'muted')
text('LABEL',466,438,9,700,'muted');text('Projekt öffnen',520,434,12,600);text('14 / 20 px · 600',774,440,9,500,'muted')
line(466,478,904,478,'lavender',.7)
para('Größenangabe = Schriftgrad / Zeilenhöhe. Fließtext linksbündig setzen, mit ruhigem Satzbild und ausreichend Abstand.',466,498,438,11.5)
para('Logo-Schriftzug stets als SVG einsetzen. Für UI und Dokumente die mitgelieferte Manrope-Version aus Google Fonts nutzen (SIL Open Font License 1.1).',466,553,438,10.5)
footer(6)

# 07 - applications
header(7,'Anwendung','Ein ruhiger Rahmen für die Marke.','Vorgeschlagene Anwendungssprache: großzügige Flächen, klare Hierarchie und gezielt eingesetztes Violett.')
# UI mock as conceptual design
rect(56,180,540,315,'white',16,stroke='lavender')
rect(56,180,540,50,'navy',16);rect(56,207,540,23,'navy')
svg('ovd-wordmark-mono-white.svg',77,194,153)
text('Übersicht',425,198,10,600,'white');text('Projekte',510,198,10,400,'inverse-accent')
text('Dein Arbeitsbereich',82,252,25,800)
text('Alles für den nächsten Schritt.',83,295,12,400,'muted')
rect(82,335,229,73,'paper',12);text('Aktuelle Projekte',98,348,12,700);text('Zuletzt bearbeitet',98,372,10,400,'muted')
rect(327,335,243,73,'lavender',12);text('Schneller Einstieg',343,348,12,700);text('Neue Ideen festhalten',343,372,10,400,'muted')
rect(82,431,156,38,'violet',8);text('Projekt öffnen',100,441,11,700,'white')
text('Beispiel einer Oberfläche; keine Funktionsspezifikation.',56,509,9,400,'muted')
# app variants
text('App-Icons',636,182,20,700)
for i,(v,lab) in enumerate([('light','Hell'),('lavender','Lavendel'),('violet','Violett'),('navy','Navy')]):
 x=636+(i%2)*145;y=225+(i//2)*156
 svg(f'ovd-app-{v}.svg',x,y,112);text(lab,x,y+119,10,600)
text('4-Pixel-Raster',56,548,16,700);para('Abstände: 4, 8, 12, 16, 24, 32, 48, 64 px.',56,577,420,10.5)
text('Weiche Radien',500,548,16,700);para('Controls: 8 px. Karten: 16 px. App-Kachel: ca. 22 %.',500,577,404,10.5)
footer(7)

# 08 - correct handling
header(8,'Konsistenz','Das Logo braucht keine Effekte.','Die gelieferten Varianten decken die vorgesehenen Einsätze ab. Neue Anwendungen beginnen immer beim Master.')
cards=[(56,180),(346,180),(636,180),(56,392),(346,392),(636,392)]
for x,y in cards:rect(x,y,268,187,'white',14)
# correct 1
symbol(83,218,214);pill('RICHTIG',73,322,75);text('Proportionen und Freiraum',161,328,9,600)
# bad distortion
svg('ovd-symbol-primary.svg',374,222,212,h=48);pill('VERMEIDEN',363,322,91,fill='#F7E5E8',ink='#9B3249');text('Stauchen oder strecken',466,328,9,600)
# bad rotation
c.saveState();c.translate(770,PAGE_H-257);c.rotate(12);c.translate(-770,-(PAGE_H-257));symbol(665,217,211);c.restoreState();pill('VERMEIDEN',653,322,91,fill='#F7E5E8',ink='#9B3249');text('Drehen',758,328,9,600)
# mono correct
rect(73,409,234,100,'navy',10);symbol(104,427,172,'mono-white');pill('RICHTIG',73,534,75);text('Passende inverse Version',161,540,9,600)
# arbitrary colors
bad=B.document(717,266,B.group(B.S,'#109389','#F38C4E'),'Falsche Farbgebung')
svg('',374,430,212,body=bad);pill('VERMEIDEN',363,534,91,fill='#F7E5E8',ink='#9B3249');text('Andere Farben',466,540,9,600)
# shadow example
shadow=B.document(717,266,B.group(B.S,'#B9BBC8','#B9BBC8'),'Schatten')
svg('',670,437,211,body=shadow);symbol(663,430,211);pill('VERMEIDEN',653,534,91,fill='#F7E5E8',ink='#9B3249');text('Zusätzliche Effekte',758,540,9,600)
para('Auch vermeiden: Konturlinien, neue Verläufe im Logo, veränderte Buchstabenabstände, neu gesetzte Wortmarken und verschobene Einzelteile.',56,595,848,10.5)
footer(8)

# 09 - production and sources
header(9,'Dateien & Reproduktion','Ein Master. Reproduzierbare Assets.','Alle SVG-Dateien enthalten echte Vektorpfade. Keine eingebetteten Bilder, externen Schriften oder nachgeladenen Ressourcen.')
text('Das Paket',56,184,21,700)
entries=[('assets/','20 SVGs: Logo, Horizontal, Wortmarke, Bildmarke und App-Icons.'),('source/','Geometrie als JSON, Farbwerte, Build-Skripte und Abhängigkeiten.'),('fonts/','Manrope als variable TTF-Datei mit zugehöriger OFL-Lizenz.'),('SHA256SUMS.txt','Prüfsummen der SVGs im Ordner assets/ zur Kontrolle identischer Builds.')]
for i,(name,desc) in enumerate(entries):
 y=231+i*67;text(name,56,y,12,700);para(desc,56,y+22,398,10.5)
text('SVGs neu erzeugen',510,184,21,700)
para('Im entpackten Paket ausführen. Python ab 3.9 genügt; der SVG-Build nutzt ausschließlich die Standardbibliothek.',510,225,394,11.5)
rect(510,293,394,69,'navy',10);text('python3 source/build_assets.py',528,317,12,'Courier','white')
para('Die Pfadquellen bleiben editierbar. Alle Varianten werden aus symbol.json und wordmark.json abgeleitet. Farben und Maßregeln stehen in tokens.json.',510,382,394,11.5)
para('Für Änderungen am Dokument: source/build_ci.py. Dieser optionale PDF-Build benötigt die Pakete aus requirements.txt. Details in LIESMICH.txt.',510,463,394,11.5)
line(56,535,904,535,'lavender')
text('Herkunft und Status',56,552,11,700)
para('Logoquelle: bereitgestellte PNG-Vorlage, 1536 × 1024 px. Diese Fassung ist eine Vektorrekonstruktion. Schutzraum, Mindestgrößen, Systemschrift und UI-Regeln sind neu definierte Empfehlungen.',56,577,456,9.5)
text('Referenzen',555,552,11,700)
text('Google Fonts / Manrope / OFL',555,578,9.5,500,'violet');c.linkURL('https://github.com/google/fonts/tree/main/ofl/manrope',(555,PAGE_H-591,820,PAGE_H-575),relative=0)
text('W3C / WCAG 2.2 / Textkontrast (1.4.3)',555,598,9.5,500,'violet');c.linkURL('https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html',(555,PAGE_H-611,890,PAGE_H-595),relative=0)
footer(9)
c.save();cache.cleanup();print(OUT)
