import type {ItemKind} from './item-types.js';

// Each shape is centered in a 244 × 160 box. The label starts below its decoration.
const shapes:Record<ItemKind,{outline:string; panels?:string; detail?:string; x:number; y:number; width:number}> = {
  mail:{
    outline:'M-122 -20 L-8 -76 Q0 -81 8 -76 L122 -20 V62 Q122 70 114 70 H-114 Q-122 70 -122 62 Z',
    panels:'M-122 -20 L-8 -76 Q0 -81 8 -76 L122 -20 L0 3 Z',
    x:-102,y:23,width:204,
  },
  calendar:{
    outline:'M-101 -57 H-64 V-65 Q-59 -74 -54 -65 V-57 H54 V-65 Q59 -74 64 -65 V-57 H101 Q109 -57 109 -49 V56 Q109 64 101 64 H-101 Q-109 64 -109 56 V-49 Q-109 -57 -101 -57 Z',
    panels:'M-109 -24 V-49 Q-109 -57 -101 -57 H101 Q109 -57 109 -49 V-24 Z',
    detail:'M-64 -57 V-44 Q-59 -36 -54 -44 V-57 M54 -57 V-44 Q59 -36 64 -44 V-57',
    x:-88,y:0,width:176,
  },
  tasks:{
    outline:'M-103 -55 H-42 Q-42 -61 -36 -61 H-17 V-66 Q-17 -75 -7 -75 H7 Q17 -75 17 -66 V-61 H36 Q42 -61 42 -55 H103 Q115 -55 115 -43 V53 Q115 65 103 65 H-103 Q-115 65 -115 53 V-43 Q-115 -55 -103 -55 Z',
    panels:'M-103 -55 H-42 V-43 H-104 V53 H104 V-43 H42 V-55 H103 Q115 -55 115 -43 V53 Q115 65 103 65 H-103 Q-115 65 -115 53 V-43 Q-115 -55 -103 -55 Z',
    detail:'M-42 -55 V-36 H42 V-55 M-7 -66 H7 M-104 -43 V53 H104 V-43 M-104 -43 H-42 M42 -43 H104',
    x:-84,y:-3,width:168,
  },
  contacts:{
    outline:'M-115 -31 L-82 -64 H82 L115 -31 V49 Q115 59 105 59 H-105 Q-115 59 -115 49 Z',
    panels:'M-115 -31 L-82 -64 H82 L115 -31 Z',
    detail:'M-23 -51 H23 A4 4 0 0 1 23 -43 H-23 A4 4 0 0 1 -23 -51 Z',
    x:-91,y:-4,width:182,
  },
  documents:{
    outline:'M-109 -73 H71 L117 -27 V63 Q117 71 109 71 H-109 Q-117 71 -117 63 V-65 Q-117 -73 -109 -73 Z',
    panels:'M71 -73 V-34 Q71 -27 78 -27 H117 Z',
    detail:'M-94 49 H-27 M-94 57 H-51',
    x:-94,y:-5,width:188,
  },
  wiki:{
    outline:'M-102 -60 H112 V61 H-102 Q-117 61 -117 46 V-45 Q-117 -60 -102 -60 Z',
    panels:'M-102 -60 H-95 V38 H-102 Q-112 38 -117 46 V-45 Q-117 -60 -102 -60 Z M74 -60 H92 V-24 L83 -31 L74 -24 Z',
    detail:'M-117 49 Q-117 38 -102 38 H112 M-99 46 H103 M-99 53 H103',
    x:-77,y:-12,width:171,
  },
  sheets:{
    outline:'M-120 -58 H120 V48 H-10 L-20 61 H-90 L-100 48 H-120 Z',
    panels:'M-120 -58 H120 V-31 H-93 V48 H-120 Z M-100 48 H-10 L-20 61 H-90 Z',
    detail:'M-120 -31 H120 M-93 -58 V-31 M-22 -58 V-31 M49 -58 V-31 M-120 -5 H-93 M-120 21 H-93 M-120 48 H120',
    x:-76,y:-10,width:182,
  },
};

export function connectionShape(kind:string) {
  const shape=Object.hasOwn(shapes,kind)?shapes[kind as ItemKind]:undefined;
  if(!shape)return {markup:'<rect class="connection-outline" x="-120" y="-32" width="240" height="64" rx="8"/>',x:-99,y:-12,width:198};
  const {outline,panels,detail,x,y,width}=shape;
  const markup=`<path class="connection-outline" d="${outline}"/>`
    +(panels?`<path class="connection-shape-panel" d="${panels}"/>`:'')
    +(detail?`<path class="connection-shape-detail" d="${detail}"/>`:'')
    +(kind==='sheets'?'<text class="connection-sheet-labels" aria-hidden="true"><tspan x="-58" y="-40">A</tspan><tspan x="13" y="-40">B</tspan><tspan x="84" y="-40">C</tspan><tspan x="-106" y="-13">1</tspan><tspan x="-106" y="13">2</tspan><tspan x="-106" y="39">3</tspan></text>':'');
  return {markup,x,y,width};
}
