/* Build mode's interface: the tool palette, the options strip that doubles as the property inspector, and what is
   drawn over the view (live dimensions with their typed fields, the snap marker, wall handles, measurements).
   It only draws what window.__build.view() describes and reports clicks through window.__build.choose(). */
(() => {
  const G = window.__game,
    BL = window.__build;
  if (!G || !BL || !BL.view) return;
  const B = BL.state,
    $ = (id) => document.getElementById(id),
    canvas = G.renderer.domElement,
    bar = $("buildbar");
  if (!bar) return;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const svg = (d, size = 24) => '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (d || "") + "</svg>";

  // drawn on a 24 unit grid, one stroke weight throughout
  const I = {
    select: '<path d="M6 3.5l12 8-5.3 1.2 3 5.9-2.3 1.2-3-5.9L6 18z"/>',
    room: '<path d="M10 19H4V5h16v14h-5"/><path d="M10 19l3.6-3.2" /><path d="M4 12h3M17 12h3" opacity=".45"/>',
    wall: '<path d="M3 7h18v10H3zM3 12h18M9 7v5M15 7v5M6 12v5M12 12v5M18 12v5"/>',
    floor: '<path d="M3 16l5-8h13l-5 8zM6.3 12h13M10.5 8l-2.2 4M15 12l-2.5 4M17.5 8L15.3 12"/>',
    roof: '<path d="M2.5 13L12 5l9.5 8M5.5 11v8h13v-8"/>',
    door: '<path d="M7 20V4.5h10V20M4.5 20h15"/><circle cx="14.3" cy="12.6" r=".9" fill="currentColor"/>',
    window: '<rect x="4.5" y="5" width="15" height="13" rx=".5"/><path d="M12 5v13M4.5 11.5h15M3 20h18"/>',
    stairs: '<path d="M3.5 19.5h4.3v-4.3h4.3v-4.3h4.3V6.6h4.1"/>',
    pillar: '<path d="M7.5 20h9M9.5 20V7M14.5 20V7M7 7h10M8.5 4.5h7"/>',
    path: '<path d="M8.5 21c0-5 6.5-5 6.5-9s-5.5-4-5.5-9M14.5 21c0-4 6-4 6-9"/>',
    decor: '<path d="M6 11V8.5A2.5 2.5 0 0 1 8.500 6h7A2.500 2.500 0 0 1 18 8.500V11"/><path d="M4 13.200a2 2 0 0 1 4 0V15h8v-1.800a2 2 0 0 1 4 0V18H4zM7 18v2M17 18v2"/>',
    equip: '<path d="M9 3.500v4.500M15 3.500v4.500M6.500 8h11v3.500a5.500 5.500 0 0 1-11 0zM12 17v3.500"/>',
    measure: '<path d="M3.500 15.500l12-12 5 5-12 12zM7.500 13.500l1.600 1.600M10 11l2.400 2.400M12.500 8.500l1.600 1.600M15 6l2.400 2.400"/>',
    erase: '<path d="M5 7h14M10 7V4.500h4V7M6.500 7l1 13h9l1-13M10 11v5.500M14 11v5.500"/>',
    undo: '<path d="M8.500 5L4 9.500 8.500 14"/><path d="M4 9.500h10a5 5 0 0 1 0 10h-3"/>',
    redo: '<path d="M15.500 5L20 9.500 15.500 14"/><path d="M20 9.500H10a5 5 0 0 0 0 10h3"/>',
    snap: '<path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4zM6 8h4M14 8h4"/>',
    up: '<path d="M6 14.500l6-6 6 6"/>',
    down: '<path d="M6 9.500l6 6 6-6"/>',
    plus: '<path d="M12 6v12M6 12h12"/>',
    minus: '<path d="M6 12h12"/>',
    turn: '<path d="M19.500 12a7.500 7.500 0 1 1-2.400-5.500M19.500 4v4.500H15"/>',
    bin: '<path d="M5 7h14M10 7V4.500h4V7M6.500 7l1 13h9l1-13M10 11v5.500M14 11v5.500"/>',
    copy: '<rect x="8.500" y="8.500" width="11" height="11" rx="1"/><path d="M15.500 8.500v-4h-11v11h4"/>',
    pick: '<path d="M14.500 4.500l5 5-2.200 1-7.800 7.800-3.500.900.900-3.500 7.800-7.800z"/><path d="M12.500 8.500l3 3"/>',
    paint: '<rect x="4" y="4" width="13" height="6" rx="1"/><path d="M17 7h3v5h-8v3M12 15v5.500"/>',
    building: '<path d="M3 20V10l6-5 6 5v10zM15 13h6v7h-6M7 20v-5h4v5"/>',
    wing: '<path d="M3 17h8v-6h10M3 20h18" /><path d="M16 7v-3.500M14 5.500l2-2 2 2"/>',
    roofs: '<path d="M2.500 12L12 4.500l9.500 7.500"/><path d="M6 17.500h12M9 20.500h6" opacity=".6"/>',
    stop: '<circle cx="12" cy="12" r="8"/><path d="M9 9l6 6M15 9l-6 6"/>',
    done: '<path d="M5 12.500l4.500 4.500L19 7.500"/>',
    "s-box": '<rect x="4.500" y="6" width="15" height="12"/>',
    "s-round": '<path d="M12 4.500l5.300 2.200 2.200 5.300-2.200 5.300-5.300 2.200-5.300-2.200L4.500 12l2.200-5.300z"/>',
    "w-wall": '<path d="M4 5.500h16V19H4zM9.300 5.500V19M14.700 5.500V19"/>',
    "w-arch": '<path d="M4 19V5.500h16V19M8 19v-6a4 4 0 0 1 8 0v6"/>',
    "w-arch2": '<path d="M4 19V5.500h16V19M8 19v-5.500c0-3 2-4.500 4-6 2 1.500 4 3 4 6V19"/>',
    "w-arch3": '<path d="M4 19V5.500h16V19M8 19V9.500h8V19M8 13l3-3.500M16 13l-3-3.500"/>',
    "w-rail": '<path d="M4.500 8.500V19M12 8.500V19M19.500 8.500V19M4.500 11h15M4.500 15.500h15"/>',
    "opening": '<path d="M3.5 20.5h17M5 20.5V6h6.5v14.5M13.5 12.5h5.5v8M13.5 12.5V8h5.5v4.500"/>',
    "o-picture": '<rect x="4" y="6" width="16" height="12" rx=".5"/><path d="M6.500 8.500l3 0"/>',
    "o-double_hung": '<rect x="6.500" y="4" width="11" height="16" rx=".5"/><path d="M6.500 12h11M12 4v16"/>',
    "o-slider": '<rect x="3.500" y="6.500" width="17" height="11" rx=".5"/><path d="M12 6.500v11M6 12h3M15 12h3"/>',
    "o-casement": '<rect x="6" y="4" width="12" height="16" rx=".5"/><path d="M6 4l12 8M6 20l12-8"/>',
    "o-awning": '<rect x="4" y="8" width="16" height="9" rx=".5"/><path d="M4 8l2-3.500h12L20 8"/>',
    "o-transom": '<rect x="4" y="9" width="16" height="5" rx=".5"/><path d="M9.300 9v5M14.700 9v5M4 19h16"/>',
    "o-arched": '<path d="M7 20V10a5 5 0 0 1 10 0v10zM12 5v15M7 13h10"/>',
    "o-clerestory": '<rect x="5" y="9.500" width="14" height="5" rx=".5"/><path d="M5 9.500l3-3h8l3 3"/>',
    "gr-none": '<rect x="5" y="4" width="14" height="16" rx=".5"/>',
    "gr-colonial": '<rect x="5" y="4" width="14" height="16" rx=".5"/><path d="M9.700 4v16M14.300 4v16M5 9.300h14M5 14.700h14"/>',
    "gr-cottage": '<rect x="5" y="4" width="14" height="16" rx=".5"/><path d="M5 10h14M9.700 4v6M14.300 4v6"/>',
    "gr-farmhouse": '<rect x="5" y="4" width="14" height="16" rx=".5"/><path d="M12 4v16M5 12h14"/>',
    "gr-craftsman": '<rect x="5" y="4" width="14" height="16" rx=".5"/><path d="M5 9.500h14M9.700 4v5.500M14.300 4v5.500"/>',
    "gr-prairie": '<rect x="5" y="4" width="14" height="16" rx=".5"/><path d="M7.500 4v16M16.500 4v16M5 6.500h14M5 17.500h14"/>',
    "gr-diamond": '<rect x="5" y="4" width="14" height="16" rx=".5"/><path d="M5 9l5-5M5 15l11-11M5 20l14-14M10 20l9-9M16 20l3-3M5 9l11 11M5 15l5 5M10 4l9 9M16 4l3 3"/>',
    "gr-sunburst": '<path d="M3 17a9 9 0 0 1 18 0z"/><path d="M12 17V8M12 17l-6.400-6.400M12 17l6.400-6.400M12 17H3.500M12 17h8.500"/>',
    "sh-rect": '<rect x="6" y="4" width="12" height="16" rx=".5"/>',
    "sh-arch": '<path d="M6 20V10a6 6 0 0 1 12 0v10z"/>',
    "sh-gothic": '<path d="M6 20v-9c0-3.500 3-6 6-8 3 2 6 4.500 6 8v9z"/>',
    "sh-half": '<path d="M3 17a9 9 0 0 1 18 0z"/>',
    "sh-round": '<circle cx="12" cy="12" r="8"/>',
    "o-full_panel": '<rect x="7" y="2.5" width="10" height="18.5" rx=".3"/><path d="M3 21h18M9.5 5l3 3"/>',
    "o-window_wall": '<rect x="2.5" y="3" width="19" height="18" rx=".3"/><path d="M8.8 3v18M15.2 3v18M9.5 6l2 2"/>',
    "o-slot": '<rect x="5" y="3" width="3.5" height="13" rx=".3"/><rect x="10.3" y="7" width="3.5" height="13" rx=".3"/><rect x="15.6" y="4.5" width="3.5" height="11" rx=".3"/>',
    "o-ribbon": '<rect x="2.5" y="9" width="19" height="5" rx=".3"/><path d="M8.8 9v5M15.2 9v5M3 19h18"/>',
    "o-tilt_turn": '<rect x="6" y="4" width="12" height="16" rx=".3"/><path d="M6 20l6-16 6 16M6 4l12 8"/>',
    "o-hopper": '<rect x="4" y="8" width="16" height="9" rx=".5"/><path d="M4 17l2 3h12l2-3"/>',
    "o-gothic": '<path d="M7 20V11c0-3.500 2.500-5.500 5-7.500 2.500 2 5 4 5 7.500v9zM12 3.500V20M7 14h10"/>',
    "o-half_round": '<path d="M3.5 16a8.5 8.5 0 0 1 17 0zM12 16V7.5M12 16l-6-6M12 16l6-6"/>',
    "o-round": '<circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16"/>',
    "o-door_single": '<path d="M7 20.500V3.500h10v17M4.500 20.500h15"/><path stroke-width="1.100" d="M8.800 5.300h2.500v2H8.800zM12.700 5.300h2.500v2h-2.500zM8.800 8.300h2.500v4.500H8.800zM12.700 8.300h2.500v4.500h-2.500zM8.800 13.800h2.500v4.600H8.800zM12.700 13.800h2.500v4.600h-2.500z"/>',
    "o-door_craftsman": '<path d="M7 20.500V3.500h10v17M4.500 20.500h15"/><path fill="currentColor" fill-opacity=".35" stroke-width="1.100" d="M8.800 5.300h1.800v3.400H8.800zM11.100 5.300h1.800v3.400h-1.800zM13.400 5.300h1.800v3.400h-1.800z"/><path stroke-width="1.100" d="M8.300 9.800h7.400M8.800 11.300h2.700v7H8.800zM12.500 11.300h2.700v7h-2.700z"/>',
    "o-door_farmhouse": '<path d="M7 20.500V3.500h10v17M4.500 20.500h15"/><path fill="currentColor" fill-opacity=".35" stroke-width="1.100" d="M8.800 5.300h6.400v4H8.800z"/><path stroke-width="1.100" d="M9.500 10.800v9.700M12 10.800v9.700M14.500 10.800v9.700M12 5.300v4"/>',
    "o-door_pivot": '<path d="M5 20.500V3.500h14v17M3 20.500h18"/><path stroke-width="1.100" d="M5 8h14M5 12.500h14M5 17h14"/><path fill="currentColor" fill-opacity=".35" stroke-width="1.100" d="M14.500 5.200h1.500v13.600h-1.500z"/><circle cx="7.500" cy="20.500" r="1" fill="currentColor"/>',
    "o-door_glass": '<path d="M7 20.500V3.500h10v17M4.500 20.500h15"/><path fill="currentColor" fill-opacity=".35" stroke-width="1.100" d="M8.300 4.800h7.400v14.500H8.300z"/><path stroke-width="1.100" d="M12 4.800v14.500M8.300 8.400h7.400M8.300 12h7.400M8.300 15.600h7.400"/>',
    "o-door_interior": '<path d="M7 20.500V3.500h10v17M4.500 20.500h15"/><path stroke-width="1.100" d="M9 5.500h6v13H9z"/><path d="M13.500 12.300h2.300"/>',
    "df-flush": '<path d="M7 20.500V3.500h10v17z"/><circle cx="15.200" cy="12.500" r=".75" fill="currentColor"/>',
    "df-groove": '<path d="M7 20.500V3.500h10v17z"/><path stroke-width="1.100" d="M7 7.500h10M7 11.500h10M7 15.500h10"/>',
    "df-shaker": '<path d="M7 20.500V3.500h10v17z"/><path stroke-width="1.100" d="M9 5.500h6v13H9z"/>',
    "df-p2": '<path d="M7 20.500V3.500h10v17z"/><path stroke-width="1.100" d="M9 5.500h6v6.700H9zM9 13.500h6v5H9z"/>',
    "df-p3": '<path d="M7 20.500V3.500h10v17z"/><path stroke-width="1.100" d="M8.800 5.500h1.800v13H8.800zM11.100 5.500h1.800v13h-1.800zM13.400 5.500h1.800v13h-1.800z"/>',
    "df-p5": '<path d="M7 20.500V3.500h10v17z"/><path stroke-width="1.100" d="M9 5.300h6v2H9zM9 8h6v2H9zM9 10.700h6v2H9zM9 13.400h6v2H9zM9 16.100h6v2.300H9z"/>',
    "df-p6": '<path d="M7 20.500V3.500h10v17z"/><path stroke-width="1.100" d="M8.800 5.300h2.500v2H8.800zM12.700 5.300h2.500v2h-2.500zM8.800 8.300h2.500v4.500H8.800zM12.700 8.300h2.500v4.500h-2.500zM8.800 13.800h2.500v4.600H8.800zM12.700 13.800h2.500v4.600h-2.500z"/>',
    "df-plank": '<path d="M7 20.500V3.500h10v17z"/><path stroke-width="1.100" d="M9.500 3.500v17M12 3.500v17M14.500 3.500v17"/>',
    "dg-none": '<path d="M7 20.500V3.500h10v17z"/><circle cx="15.200" cy="12.500" r=".75" fill="currentColor"/>',
    "dg-top": '<path d="M7 20.500V3.500h10v17z"/><path fill="currentColor" fill-opacity=".35" stroke-width="1.100" d="M9 5.500h6v3.300H9z"/>',
    "dg-half": '<path d="M7 20.500V3.500h10v17z"/><path fill="currentColor" fill-opacity=".35" stroke-width="1.100" d="M9 5.500h6v6.700H9z"/>',
    "dg-three": '<path d="M7 20.500V3.500h10v17z"/><path fill="currentColor" fill-opacity=".35" stroke-width="1.100" d="M9 5.500h6v10H9z"/>',
    "dg-full": '<path d="M7 20.500V3.500h10v17z"/><path fill="currentColor" fill-opacity=".35" stroke-width="1.100" d="M9 5.500h6v13H9z"/>',
    "dg-craft": '<path d="M7 20.500V3.500h10v17z"/><path fill="currentColor" fill-opacity=".35" stroke-width="1.100" d="M8.800 5.300h1.800v3.400H8.800zM11.100 5.300h1.800v3.400h-1.800zM13.400 5.300h1.800v3.400h-1.800z"/><path stroke-width="1.100" d="M8.300 9.800h7.400"/>',
    "dg-slot": '<path d="M7 20.500V3.500h10v17z"/><path fill="currentColor" fill-opacity=".35" stroke-width="1.100" d="M13 5.500h1.700v13H13z"/>',
    "dg-bars": '<path d="M5 5h14v14H5z"/><path stroke-width="1.100" d="M9.700 5v14M14.300 5v14M5 9.700h14M5 14.300h14"/>',
    "dg-transom": '<path d="M7 20.500V9.500h10v11"/><path fill="currentColor" fill-opacity=".35" stroke-width="1.100" d="M5.500 3.500h13v4h-13z"/>',
    "o-door_french": '<path d="M4.500 20.500V4h15v16.500M12 4v16.500M3 20.500h18"/><circle cx="10.300" cy="12.800" r=".8" fill="currentColor"/><circle cx="13.700" cy="12.800" r=".8" fill="currentColor"/>',
    "o-door_patio": '<path d="M3.500 4h17v16.500h-17zM12 4v16.500M8 12h2.500M13.500 12h2.500"/>',
    "o-door_dutch": '<path d="M7 20.500V4h10v16.500M7 12.500h10M4.500 20.500h15"/><circle cx="14.300" cy="14.500" r=".8" fill="currentColor"/>',
    "o-door_barn": '<path d="M3 4.500h18M6.500 7h11v13.500h-11zM6.500 7l11 13.500M17.500 7l-11 13.500"/>',
    "o-door_pocket": '<path d="M3.500 20.500h17M5 4v16.500M5 4h6M15 4v16.500M5 6.500h8v14M13 6.500l6 0M19 6v14.500"/>',
    "o-door_bifold": '<path d="M5 4h14v16.500H5zM12 4v16.500M8.500 6.500v12M15.500 6.500v12"/>',
    "o-door_garage": '<path d="M3.500 20.500V6h17v14.500M3.500 10h17M3.500 14h17M3.500 17.500h17"/>',
    "d-door": '<path d="M7 20V4.500h10V20M4.500 20h15"/><circle cx="14.300" cy="12.600" r=".9" fill="currentColor"/>',
    "d-door2": '<path d="M5 20V4.500h14V20M12 4.500V20M3 20h18"/><circle cx="10" cy="12.600" r=".8" fill="currentColor"/><circle cx="14" cy="12.600" r=".8" fill="currentColor"/>',
    "n-window": '<rect x="4.500" y="5.500" width="15" height="13"/><path d="M12 5.500v13M4.500 12h15"/>',
    "n-window2": '<path d="M6 19v-8.500a6 6 0 0 1 12 0V19zM12 4.500V19M6 12.500h12"/>',
    "n-window4": '<path d="M9 6h6v12H9zM9 12h6M4 6h3v12H4zM17 6h3v12h-3z"/>',
    "r-gable": '<path d="M3 17.500l5-9.500 5 9.500zM8 8h9l4 9.500h-8"/>',
    "r-hip": '<path d="M2.500 17.500l6-8.500h7l6 8.500zM8.500 9l2.500 8.500M15.500 9L13 17.500"/>',
    "r-shed": '<path d="M3.500 18.500V8l17 6.500v4z"/>',
    "r-flat": '<path d="M3 12.500h18V17H3zM5 12.500v-2.500h14v2.500"/>',
    "r-gambrel": '<path d="M2.500 18V13.500L6 8.500 12 5.500 18 8.500 21.500 13.500V18M6 8.500h12"/>',
    "r-saltbox": '<path d="M3 18v-6L9 5.500 21 15v3zM9 5.500V18"/>',
    "r-steep": '<path d="M6.500 19.500L12 4l5.500 15.500z"/>',
    "t-none": '<circle cx="12" cy="12" r="7" stroke-dasharray="2.500 3"/>',
    "t-cone": '<path d="M5 19.500L12 4.500l7 15z"/>',
    "t-dome": '<path d="M4.500 19a7.500 10 0 0 1 15 0z"/>',
    "p-pillar": '<path d="M7.500 20h9M9.500 20V7M14.500 20V7M7 7h10M8.500 4.500h7"/>',
    "p-chimney": '<path d="M8 20.500V9h8v11.500M6.500 9h11M9.500 9V6h5v3"/><path d="M12 3.500c1-.800 1-1.700 2-2" opacity=".6"/>',
  };
  // a small picture of a material, drawn from its two colours
  function swatch(sw) {
    const [kind, a, b] = sw;
    let d = '<rect width="24" height="24" fill="' + a + '"/>';
    const st = ' stroke="' + b + '" stroke-width="1.6" fill="none"';
    if (kind === "planks") d += "<path" + st + ' d="M6 0v19M12 0v19M18 0v19"/><rect y="19" width="24" height="5" fill="' + b + '"/>';
    else if (kind === "courses") d += "<path" + st + ' stroke-width="1.3" d="M0 6h24M0 12h24M0 18h24M8 0v6M18 0v6M3 6v6M13 6v6M8 12v6M18 12v6M3 18v6M13 18v6"/>';
    else if (kind === "flat") d += '<rect x="10" width="4" height="24" fill="' + b + '"/><rect y="20" width="24" height="4" fill="' + b + '"/>';
    else if (kind === "brace") d += "<path" + st + ' stroke-width="3" d="M1.500 0v24M22.500 0v24M0 1.500h24M2 22L22 3"/>';
    else if (kind === "boards") d += "<path" + st + ' stroke-width="1.300" d="M0 6h24M0 12h24M0 18h24M9 0v6M16 6v6M6 12v6M14 18v6"/>';
    else if (kind === "bare") d += '<path stroke="' + b + '" stroke-width="1.6" d="M3 21L21 3"/>';
    else if (kind === "check") d += '<path fill="' + b + '" d="M0 0h8v8H0zM16 0h8v8h-8zM8 8h8v8H8zM0 16h8v8H0zM16 16h8v8h-8z"/>';
    else if (kind === "roof") d += "<path" + st + ' stroke-width="1.400" d="M0 6q3 3 6 0t6 0 6 0 6 0M0 12q3 3 6 0t6 0 6 0 6 0M0 18q3 3 6 0t6 0 6 0 6 0"/>';
    else if (kind === "asph") d += "<path" + st + ' stroke-width="1.100" d="M0 5h24M0 10h24M0 15h24M0 20h24M6 0v5M14 0v5M22 0v5M2 5v5M10 5v5M18 5v5M6 10v5M14 10v5M22 10v5M2 15v5M10 15v5M18 15v5M6 20v4M14 20v4"/>';
    else if (kind === "seam") d += "<path" + st + ' stroke-width="1.500" d="M4 0v24M12 0v24M20 0v24"/>';
    else if (kind === "corr") d += "<path" + st + ' stroke-width="1" d="M2 0v24M5 0v24M8 0v24M11 0v24M14 0v24M17 0v24M20 0v24M23 0v24"/>';
    else if (kind === "green") d += '<g fill="' + b + '"><circle cx="5" cy="5" r="2.500"/><circle cx="14" cy="4" r="2"/><circle cx="20" cy="9" r="2.600"/><circle cx="9" cy="12" r="2.400"/><circle cx="4" cy="19" r="2.200"/><circle cx="15" cy="17" r="2.700"/><circle cx="21" cy="21" r="1.800"/></g><circle cx="11" cy="20" r="1.600" fill="#9a5a46"/><circle cx="17" cy="11" r="1.400" fill="#b5b04e"/>';
    else if (kind === "path") d += '<g fill="' + b + '"><circle cx="5" cy="6" r="2.200"/><circle cx="14" cy="4.500" r="1.800"/><circle cx="19" cy="11" r="2.300"/><circle cx="9" cy="13" r="2"/><circle cx="4.500" cy="19" r="1.800"/><circle cx="15" cy="19" r="2.300"/></g>';
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + "</svg>";
  }

  /* ---------- the bar ---------- */
  // Three slim rows: a hint line (with what can be done to the selection), the options strip, the tools. The
  // options strip folds away (`) for an even lower bar; build mode shifts the view up by half the bar's height.
  bar.innerHTML =
    '<div id="bhead"><span id="bhint" aria-live="polite"></span><button id="bstop" class="ui-btn ui-btn--go" type="button" hidden>' + svg(I.stop, 14) + '<span>Stop</span><kbd>Esc</kbd></button><span class="grow"></span><div id="bacts" role="group" aria-label="Selection"></div>' +
    '<button id="bfold" class="ui-btn ui-btn--ghost" type="button" title="Hide or show the options ( ` )" aria-expanded="true"><span>Options</span>' + svg(I.down, 14) + "</button></div>" +
    '<div id="bopts" role="group" aria-label="Options"></div><div id="bdecor" role="group" aria-label="Pieces" hidden></div>' +
    '<div id="bmain"><div id="bpieces" role="group" aria-label="Build tools"></div><div id="baids">' +
    '<button id="bsnap" class="ui-slot" type="button" aria-pressed="true" title="Snap to the grid, to ends, middles and walls, and to round angles ( / ). Hold Ctrl to place freely.">' + svg(I.snap, 20) + '<span class="name">Snap</span><span class="key ui-key">/</span></button>' +
    '<div id="blevel" class="ui-step" title="The storey you are working on (Page Up, Page Down)"><button id="bldn" type="button" aria-label="Storey down">' + svg(I.down, 16) + '</button><span id="blname" class="n">Ground</span><button id="blup" type="button" aria-label="Storey up">' + svg(I.up, 16) + "</button></div>" +
    '<button id="bsched" class="ui-slot" type="button" aria-pressed="false" title="The schedule: what this building needs, stage by stage">' + svg('<path d="M6 4h12v16H6zM9 8h6M9 12h6M9 16h4"/>', 20) + '<span class="name">List</span></button>' +
    '<button id="bfree" class="ui-btn" type="button" aria-pressed="true" title="When off, pieces cost wood and removing them refunds it">Free</button>' +
    '<button id="bundo" class="ui-btn ui-btn--icon" type="button" title="Undo (Ctrl+Z)" aria-label="Undo">' + svg(I.undo, 18) + '<span>Undo</span></button><button id="bredo" class="ui-btn ui-btn--icon" type="button" title="Redo (Ctrl+Shift+Z)" aria-label="Redo">' + svg(I.redo, 18) + "<span>Redo</span></button>" +
    '<button id="bdone" class="ui-slot" type="button" title="Leave build mode (B)">' + svg(I.done, 20) + '<span class="name">Done</span><span class="key ui-key">B</span></button></div></div>';
  const pieces = $("bpieces");
  let grp = -1;
  for (const t of BL.view().tools) {
    if (t.group !== grp && grp >= 0) pieces.insertAdjacentHTML("beforeend", '<span class="sep" aria-hidden="true"></span>');
    grp = t.group;
    const letter = BL.TOOL_LETTER[t.id] || "";
    pieces.insertAdjacentHTML("beforeend", '<button type="button" data-piece="' + t.id + '" title="' + t.name + " (" + letter + (t.key === letter ? "" : " or " + t.key) + ')" aria-pressed="false">' + svg(I[t.id], 19) + '<span class="name">' + t.name + '</span><span class="key ui-key">' + letter + "</span></button>");
  }
  const back = () => canvas.focus();
  pieces.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-piece]");
    b && (BL.setTool(b.dataset.piece), back());
  });
  const press = (id, what, v) => $(id).addEventListener("click", () => (BL.choose(what, v), back()));
  press("bundo", "undo");
  press("bredo", "redo");
  press("bsnap", "snap");
  press("bfree", "free");
  press("bdone", "done");
  press("bstop", "stop");
  press("blup", "level", 1);
  press("bldn", "level", -1);
  press("bfold", "fold");
  press("bsched", "sched");
  // the schedule: the bill of materials by stage, in a panel at the side
  const sched = document.createElement("div");
  sched.id = "bschedp";
  sched.className = "panel ui-panel ui-panel--side";
  sched.hidden = true;
  document.body.appendChild(sched);
  const money = (v) => "$" + Math.round(v).toLocaleString("en-US");
  function renderSched(d) {
    sched.hidden = !d;
    $("bsched").setAttribute("aria-pressed", d ? "true" : "false");
    if (!d) return;
    sched.style.bottom = (B.barH || 130) + 10 + "px";
    sched.innerHTML =
      "<h2>Schedule<small>" + esc(d.title) + "</small></h2>" +
      (d.stages.length
        ? d.stages
            .map((st) => '<section><h3><span>' + esc(st.name) + "</span><small>" + (st.built === st.of ? "built" : st.built ? st.built + " of " + st.of + " built" : "planned") + "</small><b>" + money(st.cost) + "</b></h3>" + st.lines.map((ln) => '<div class="ln" title="' + esc(ln.why) + '"><span>' + esc(ln.label) + "</span><i>" + esc(ln.qty) + "</i><b>" + (ln.missing ? "not sold yet" : money(ln.cost)) + "</b><em>" + esc(ln.why) + "</em></div>").join("") + "</section>")
            .join("") + '<div class="tot"><span>Total</span><b>' + money(d.total) + "</b></div>"
        : '<p class="none">Nothing to list yet. Draw a room, or set down a plan.</p>');
  }

  /* ---------- the window designer's drawing: the window to scale on its wall, floor to eave ---------- */
  function winPreview(g) {
    const H = 128,
      W = 176,
      k = Math.min((H - 22) / Math.max(g.wallH, g.h + g.sill + 0.2), (W - 48) / Math.max(g.w, 0.5)),
      L = g.look,
      ww = g.w * k,
      wh = g.h * k,
      x0 = (W - ww) / 2,
      yF = H - 6,
      y0 = yF - (g.sill + g.h) * k,
      y1 = yF - g.sill * k,
      fw = Math.max(1.5, (L.slim ? 0.04 : 0.055) * k),
      gx0 = x0 + fw,
      gx1 = x0 + ww - fw,
      gy0 = y0 + fw,
      gy1 = y1 - fw,
      hw = (gx1 - gx0) / 2,
      cx = (gx0 + gx1) / 2,
      shape = L.shape || "rect",
      f = (v) => Math.round(v * 10) / 10;
    // the glass outline as a path
    let glass;
    if (shape === "round") glass = '<ellipse cx="' + f(cx) + '" cy="' + f((gy0 + gy1) / 2) + '" rx="' + f(hw) + '" ry="' + f((gy1 - gy0) / 2) + '"/>';
    else if (shape === "half") glass = '<path d="M' + f(gx0) + " " + f(gy1) + "A" + f(hw) + " " + f(gy1 - gy0) + " 0 0 1 " + f(gx1) + " " + f(gy1) + 'Z"/>';
    else if (shape === "arch") {
      const r = Math.min(hw, (gy1 - gy0) * 0.45);
      glass = '<path d="M' + f(gx0) + " " + f(gy1) + "V" + f(gy0 + r) + "A" + f(hw) + " " + f(r) + " 0 0 1 " + f(gx1) + " " + f(gy0 + r) + "V" + f(gy1) + 'Z"/>';
    } else if (shape === "gothic") {
      const r = Math.min(hw * 1.732, (gy1 - gy0) * 0.6);
      glass = '<path d="M' + f(gx0) + " " + f(gy1) + "V" + f(gy0 + r) + "Q" + f(gx0) + " " + f(gy0 + r * 0.25) + " " + f(cx) + " " + f(gy0) + "Q" + f(gx1) + " " + f(gy0 + r * 0.25) + " " + f(gx1) + " " + f(gy0 + r) + "V" + f(gy1) + 'Z"/>';
    } else glass = '<rect x="' + f(gx0) + '" y="' + f(gy0) + '" width="' + f(gx1 - gx0) + '" height="' + f(gy1 - gy0) + '"/>';
    let lines = "";
    const ln = (a, b, c, d, w2) => (lines += '<path d="M' + f(a) + " " + f(b) + "L" + f(c) + " " + f(d) + '" stroke-width="' + w2 + '"/>');
    const [lx, ly] = L.lites;
    for (let i = 1; i < lx; i++) ln(gx0 + ((gx1 - gx0) * i) / lx, gy0, gx0 + ((gx1 - gx0) * i) / lx, gy1, 2);
    for (let j = 1; j < ly; j++) ln(gx0, gy0 + ((gy1 - gy0) * j) / ly, gx1, gy0 + ((gy1 - gy0) * j) / ly, 2);
    if (g.op === "double_hung" && shape === "rect") ln(gx0, (gy0 + gy1) / 2, gx1, (gy0 + gy1) / 2, 2.2);
    // the grille, drawn per pane
    const gr = L.grille,
      [nx, ny] = L.grid;
    for (let i = 0; i < lx; i++)
      for (let j = 0; j < ly; j++) {
        const a = gx0 + ((gx1 - gx0) * i) / lx,
          b = gx0 + ((gx1 - gx0) * (i + 1)) / lx,
          p = gy0 + ((gy1 - gy0) * j) / ly,
          q = gy0 + ((gy1 - gy0) * (j + 1)) / ly;
        if (gr === "colonial") {
          for (let u = 1; u < nx; u++) ln(a + ((b - a) * u) / nx, p, a + ((b - a) * u) / nx, q, 0.8);
          for (let v = 1; v < ny; v++) ln(a, p + ((q - p) * v) / ny, b, p + ((q - p) * v) / ny, 0.8);
        } else if (gr === "cottage" || gr === "craftsman") {
          const yc = g.op === "double_hung" ? (p + q) / 2 : p + (q - p) * (gr === "cottage" ? 0.36 : 0.34),
            n = gr === "craftsman" ? Math.max(2, nx) : nx;
          g.op === "double_hung" || ln(a, yc, b, yc, 0.8);
          for (let u = 1; u < n; u++) ln(a + ((b - a) * u) / n, p, a + ((b - a) * u) / n, yc, 0.8);
          if (gr === "cottage" && g.op === "double_hung") for (let v = 1; v < Math.round(ny / 2); v++) ln(a, p + ((yc - p) * v) / Math.round(ny / 2), b, p + ((yc - p) * v) / Math.round(ny / 2), 0.8);
        } else if (gr === "farmhouse") ln((a + b) / 2, p, (a + b) / 2, q, 0.8), g.op === "double_hung" || ln(a, (p + q) / 2, b, (p + q) / 2, 0.8);
        else if (gr === "prairie") {
          const e = Math.min(0.09 * k, 0.2 * Math.min(b - a, q - p));
          ln(a + e, p, a + e, q, 0.8), ln(b - e, p, b - e, q, 0.8), ln(a, p + e, b, p + e, 0.8), ln(a, q - e, b, q - e, 0.8);
        } else if (gr === "diamond") {
          const sx = (b - a) / nx;
          for (let u = -ny * 2; u <= nx + ny * 2; u++) ln(a + u * sx, q, a + u * sx + (q - p) * (sx / ((q - p) / ny)), p, 0.7), ln(a + u * sx, q, a + u * sx - (q - p) * (sx / ((q - p) / ny)), p, 0.7);
        } else if (gr === "sunburst") {
          const n = Math.max(4, nx + 3);
          for (let u = 1; u < n; u++) ln((a + b) / 2, q, (a + b) / 2 + Math.cos((Math.PI * u) / n) * (b - a), q - Math.sin((Math.PI * u) / n) * (b - a), 0.8);
        }
      }
    // dimension lines: the width over it, the height beside it, the sill from the floor
    const dl = (x1, y1, x2, y2, tx, ty, t, anchor) => '<path d="M' + f(x1) + " " + f(y1) + "L" + f(x2) + " " + f(y2) + '" stroke="#9fe3ff" stroke-width=".8" marker-start="url(#' + "IDa" + ')" marker-end="url(#' + "IDa" + ')"/><text x="' + f(tx) + '" y="' + f(ty) + '" font-size="8" fill="#9fe3ff" text-anchor="' + (anchor || "middle") + '">' + t + "</text>";
    const m2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
    let dims = dl(x0, y0 - 5, x0 + ww, y0 - 5, x0 + ww / 2, y0 - 8, m2(g.w)) + dl(x0 + ww + 5, y0, x0 + ww + 5, y1, x0 + ww + 8, (y0 + y1) / 2 + 3, m2(g.h), "start");
    if (g.sill > 0.04) dims += dl(x0 - 5, y1, x0 - 5, yF, x0 - 8, (y1 + yF) / 2 + 3, m2(g.sill), "end");
    const id = "wpc" + ((Math.random() * 1e6) | 0);
    dims = dims.split("IDa").join(id + "a");
    return (
      '<svg class="bwp" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" aria-label="Window preview">' +
      '<defs><marker id="' + id + 'a" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L6 3L0 6z" fill="#9fe3ff"/></marker><clipPath id="' + id + '">' + glass + '</clipPath><linearGradient id="' + id + 'g" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="#cfe3ef"/><stop offset=".55" stop-color="#7d9fb4"/><stop offset=".56" stop-color="#4c5f58"/><stop offset="1" stop-color="#3a4741"/></linearGradient></defs>' +
      '<rect x="0" y="' + f(yF - g.wallH * k) + '" width="' + W + '" height="' + f(g.wallH * k) + '" fill="rgba(255,255,255,.06)"/>' +
      '<path d="M0 ' + f(yF) + "H" + W + '" stroke="currentColor" stroke-width="1.2" opacity=".6"/>' +
      '<path d="M0 ' + f(yF - g.wallH * k) + "H" + W + '" stroke="currentColor" stroke-width=".8" stroke-dasharray="3 3" opacity=".4"/>' +
      '<rect x="' + f(x0) + '" y="' + f(y0) + '" width="' + f(ww) + '" height="' + f(wh) + '" fill="' + g.finish + '" stroke="rgba(0,0,0,.4)" stroke-width=".6"/>' +
      '<g fill="url(#' + id + 'g)">' + glass + "</g>" +
      '<g clip-path="url(#' + id + ')" stroke="' + g.finish + '" fill="none">' + lines + "</g>" +
      dims +
      "</svg>"
    );
  }

  /* ---------- the options strip and inspector ---------- */
  const opts = $("bopts"),
    row2 = $("bdecor"),
    // the window and door designer: a panel docked at the right, above the bar, clear of the wall being worked on
    dpanel = document.createElement("div");
  dpanel.id = "bdesign";
  dpanel.className = "panel ui-panel ui-panel--side";
  dpanel.hidden = true;
  document.body.appendChild(dpanel);
  let groups = [];
  const keyHint = (k) => (k ? "<kbd>" + esc(k) + "</kbd>" : "");
  function groupHtml(g, n) {
    const lab = (extra) => '<span class="blab">' + esc(g.label || "") + (extra !== undefined ? ' <b class="bval">' + esc(extra) + "</b>" : "") + keyHint(g.key) + "</span>";
    const cur = g.items ? g.items.find((x) => x.v === g.value) : null;
    if (g.type === "num")
      return '<div class="bgroup bnumg">' + lab() + '<div class="bitems bnumi ui-step"><button type="button" class="bchip" data-g="' + n + '" data-i="-1" aria-label="Less">' + svg(I.minus, 13) + '</button><input type="text" inputmode="decimal" autocomplete="off" data-g="' + n + '" value="' + esc(g.value) + '" aria-label="' + esc(g.label) + '"><span class="bu u">' + esc(g.unit || "") + '</span><button type="button" class="bchip" data-g="' + n + '" data-i="1" aria-label="More">' + svg(I.plus, 13) + "</button></div>" + (g.note ? '<span class="bnote' + (g.bad ? " bad" : "") + '">' + esc(g.note) + "</span>" : "") + "</div>";
    if (g.type === "badges") return '<div class="bgroup bbadges">' + g.items.map((x) => '<span class="bbadge ui-tag' + (x.k ? " k-" + x.k : "") + '"' + (x.title ? ' title="' + esc(x.title) + '"' : "") + ">" + esc(x.text) + "</span>").join("") + "</div>";
    if (g.type === "winprev") return '<div class="bgroup bwinprev">' + lab() + winPreview(g) + "</div>";
    if (g.type === "info") return '<div class="bgroup binfo"><span class="btitle">' + esc(g.title) + '</span><span class="bnum">' + esc(g.text) + "</span></div>";
    if (g.type === "swatches") return '<div class="bgroup">' + lab(cur ? cur.name : g.value === null ? "mixed" : "") + '<div class="bitems">' + g.items.map((x, m) => '<button type="button" class="bsw" data-g="' + n + '" data-i="' + m + '" title="' + esc(x.name) + '" aria-label="' + esc(x.name) + '" aria-pressed="' + (x.v === g.value) + '">' + swatch(x.sw) + "</button>").join("") + "</div></div>";
    // tiles are icons; the label above names the one that is chosen (or the one under the pointer)
    if (g.type === "tiles") return '<div class="bgroup">' + lab(cur ? cur.name : g.value === null ? "mixed" : "") + '<div class="bitems ui-seg">' + g.items.map((x, m) => '<button type="button" class="btile" data-g="' + n + '" data-i="' + m + '" title="' + esc(x.name) + '" aria-label="' + esc(x.name) + '" aria-pressed="' + (x.v === g.value) + '">' + svg(I[x.icon], 19) + "</button>").join("") + "</div></div>";
    if (g.type === "chips") return '<div class="bgroup">' + (g.label ? lab(cur && cur.note ? cur.note : undefined) : "") + '<div class="bitems ui-seg">' + g.items.map((x, m) => '<button type="button" class="bchip" data-g="' + n + '" data-i="' + m + '" aria-pressed="' + (x.v === g.value) + '"' + (x.note ? ' title="' + esc(x.note) + '"' : "") + ">" + esc(x.name) + "</button>").join("") + "</div></div>";
    if (g.type === "stepper") return '<div class="bgroup">' + lab() + '<div class="bitems bstep ui-step"><button type="button" class="bchip" data-g="' + n + '" data-i="-1" aria-label="Less">' + svg(I.minus, 14) + '</button><span class="bnum n">' + esc(g.text) + '</span><button type="button" class="bchip" data-g="' + n + '" data-i="1" aria-label="More">' + svg(I.plus, 14) + "</button></div></div>";
    if (g.type === "toggle") return '<div class="bgroup"><span class="blab">&nbsp;</span><div class="bitems"><button type="button" class="btile" data-g="' + n + '" aria-pressed="' + !!g.on + '" title="' + esc(g.title || g.name) + '">' + svg(I[g.icon], 17) + "<span>" + esc(g.name) + "</span></button></div></div>";
    if (g.type === "action") return '<div class="bgroup"><span class="blab">' + (g.key ? keyHint(g.key) : "&nbsp;") + '</span><div class="bitems"><button type="button" class="btile' + (g.danger ? " danger" : "") + '" data-g="' + n + '"' + (g.title ? ' title="' + esc(g.title) + '"' : "") + ">" + svg(I[g.icon], 17) + "<span>" + esc(g.name) + "</span></button></div></div>";
    if (g.type === "field") return '<div class="bgroup">' + lab() + '<div class="bitems bfield" title="' + esc(g.title || "") + '"><input type="text" inputmode="decimal" autocomplete="off" data-g="' + n + '" value="' + esc(g.value) + '" aria-label="' + esc(g.label) + '"' + (g.locked ? " disabled" : "") + "><span>" + esc(g.unit) + "</span></div></div>";
    if (g.type === "select") return '<div class="bgroup">' + lab() + '<div class="bitems bfield" title="' + esc(g.title || "") + '"><select data-g="' + n + '" aria-label="' + esc(g.label) + '">' + g.items.map((x, m) => '<option value="' + m + '"' + (x.v === g.value ? " selected" : "") + ">" + esc(x.name) + "</option>").join("") + "</select></div></div>";
    return "";
  }
  function renderOpts(v) {
    groups = v.groups;
    const first = [],
      second = [],
      third = [];
    // what can be done with the selection sits in the top row
    const acts = [];
    // groups with a section name are boxed together under it
    let sec = null;
    const put = (arr, html, g) => {
      if (g.sec) {
        if (!sec || sec.name !== g.sec || sec.arr !== arr) ((sec = { name: g.sec, arr, html: [] }), arr.push(sec));
        sec.html.push(html);
      } else ((sec = null), arr.push(html));
    };
    groups.forEach((g, n) => {
      if (g.type === "action" && g.id.startsWith("s:")) acts.push('<button type="button" class="bchip' + (g.danger ? " danger" : "") + '" data-g="' + n + '" title="' + esc(g.title || g.name) + (g.key ? " (" + esc(g.key) + ")" : "") + '">' + svg(I[g.icon], 15) + "<span>" + esc(g.name) + "</span></button>");
      else put(g.row === "d" ? third : g.row === 2 ? second : first, groupHtml(g, n), g);
    });
    const flat = (arr) => arr.map((x) => (typeof x === "string" ? x : '<div class="bsec ui-card"><div class="bsech">' + esc(x.name) + '</div><div class="bsecb">' + x.html.join("") + "</div></div>")).join("");
    $("bacts").innerHTML = acts.join("");
    opts.innerHTML = flat(first);
    opts.hidden = !first.length;
    row2.innerHTML = flat(second);
    const was = dpanel.querySelector("input:focus");
    dpanel.innerHTML = third.length ? '<div class="bdtitle">' + esc(v.designTitle || "Designer") + "</div>" + flat(third) : "";
    dpanel.hidden = !third.length;
    if (was) {
      const again = dpanel.querySelector('input[data-g="' + was.dataset.g + '"]');
      again && again.focus();
    }
    row2.hidden = !second.length;
  }
  const onPick = (e) => {
    const b = e.target.closest("button[data-g]");
    if (!b) return;
    const g = groups[+b.dataset.g];
    BL.choose(g.id, g.type === "stepper" ? +b.dataset.i : g.type === "num" ? { step: +b.dataset.i } : g.items ? g.items[+b.dataset.i].v : undefined);
    back();
  };
  opts.addEventListener("click", onPick);
  $("bacts").addEventListener("click", onPick);
  row2.addEventListener("click", onPick);
  // pointing at a swatch or an icon names it in the group's label
  const named = (e) => e.target.closest(".bsw, .btile[data-i]");
  opts.addEventListener("pointerover", (e) => {
    const b = named(e);
    if (!b) return;
    const val = b.closest(".bgroup").querySelector(".bval");
    if (val) val.textContent = b.title;
  });
  opts.addEventListener("pointerout", (e) => {
    const b = named(e);
    if (!b) return;
    const g = groups[+b.dataset.g],
      cur = g.items.find((x) => x.v === g.value),
      val = b.closest(".bgroup").querySelector(".bval");
    if (val) val.textContent = cur ? cur.name : g.value === null ? "mixed" : "";
  });
  // typed properties of the selection
  dpanel.addEventListener("click", onPick);
  for (const el of [row2, dpanel]) {
    el.addEventListener("keydown", (e) => {
      if (e.target.tagName !== "INPUT") return;
      e.stopPropagation();
      if (e.key === "Enter") e.target.blur();
      else if (e.key === "Escape") ((e.target.value = e.target.defaultValue), e.target.blur(), back());
    });
    el.addEventListener("change", (e) => {
      if (e.target.tagName !== "INPUT") return;
      const g = groups[+e.target.dataset.g],
        v = parseFloat(e.target.value.replace(",", "."));
      isFinite(v) ? BL.choose(g.id, v) : (e.target.value = e.target.defaultValue);
      back();
    });
  }
  opts.addEventListener("keydown", (e) => {
    if (e.target.tagName !== "INPUT") return;
    e.stopPropagation();
    if (e.key === "Enter") e.target.blur();
    else if (e.key === "Escape") ((e.target.value = e.target.defaultValue), e.target.blur(), back());
  });
  opts.addEventListener("change", (e) => {
    const g = groups[+e.target.dataset.g];
    if (e.target.tagName === "SELECT") return (BL.choose(g.id, g.items[+e.target.value].v), back());
    if (e.target.tagName !== "INPUT") return;
    if (g.text) return (BL.choose(g.id, e.target.value), back());
    const v = parseFloat(e.target.value.replace(",", "."));
    isFinite(v) ? BL.choose(g.id, v) : (e.target.value = e.target.defaultValue);
    back();
  });

  /* ---------- drawn over the view ---------- */
  const over = document.createElement("div");
  over.id = "bover";
  over.innerHTML = '<div id="bmarq" hidden></div><div id="bsnapm" hidden><i></i><span></span></div>';
  document.body.appendChild(over);
  const marq = $("bmarq"),
    snapEl = $("bsnapm"),
    lb = $("blabel");
  const pool = (cls, n, html) =>
    Array.from({ length: n }, () => {
      const d = document.createElement("div");
      d.className = cls;
      d.hidden = true;
      d.innerHTML = html || "";
      over.appendChild(d);
      return d;
    });
  const dimEls = pool("bdim", 8, '<input type="text" inputmode="decimal" autocomplete="off" size="4" aria-label="Exact size"><span class="u"></span><span class="t"></span><em></em>'),
    handleEls = pool("bhandle", 6),
    measEls = pool("bmeas", 9, '<span></span><button type="button" aria-label="Clear this measurement">' + svg('<path d="M7 7l10 10M17 7L7 17"/>', 12) + "</button>");
  // port dots on equipment (drag or click from one to another to run a wire or pipe) and a tag on each run
  const portEls = pool("bport", 48, "<span></span>");
  for (const d of portEls) {
    d.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const q = d._q;
      if (!q) return;
      q.lid ? BL.choose("fx:sel", q.lid) : BL.port(q.fid, q.pid, false);
    });
    d.addEventListener("pointerup", (e) => {
      e.stopPropagation();
      const q = d._q;
      q && !q.lid && !q.from && BL.port(q.fid, q.pid, true);
      back();
    });
  }
  const v3 = new G.THREE.Vector3();
  let rc = canvas.getBoundingClientRect();
  window.addEventListener("resize", () => ((rc = canvas.getBoundingClientRect()), (lastCam = NaN)));
  const place = (el, x, y, z, dx, dy) => {
    v3.set(x, y, z).project(G.camera);
    const sx = Math.round(rc.left + (v3.x * 0.5 + 0.5) * rc.width + (dx || 0)),
      sy = Math.round(rc.top + (-v3.y * 0.5 + 0.5) * rc.height + (dy || 0));
    if (el._x !== sx || el._y !== sy) ((el._x = sx), (el._y = sy), (el.style.transform = "translate(" + sx + "px," + sy + "px)"));
    return v3.z < 1;
  };
  const show = (el, on) => {
    if (el.hidden === on) el.hidden = !on;
  };
  const text = (el, s) => {
    if (el._t !== s) ((el._t = s), (el.textContent = s));
  };
  // typed sizes: each field holds what was typed until the stroke ends
  const typed = { a: "", b: "" };
  const fieldOf = (name) => dimEls.find((d) => !d.hidden && d._f === name);
  function sendTyped() {
    BL.typed(typed.a === "" ? null : typed.a.replace(",", "."), typed.b === "" ? null : typed.b.replace(",", "."));
  }
  for (const d of dimEls) {
    const inp = d.firstChild;
    inp.addEventListener("input", () => {
      if (!d._f) return;
      typed[d._f] = inp.value.trim();
      sendTyped();
    });
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") (e.preventDefault(), inp.blur(), back(), BL.typedCommit());
      else if (e.key === "Escape") ((typed.a = typed.b = ""), BL.typedClear(), inp.blur(), back());
      else if (e.key === "Tab" || e.key === ",") {
        e.preventDefault();
        const other = fieldOf(d._f === "a" ? "b" : "a");
        other ? (other.firstChild.focus(), other.firstChild.select()) : 0;
      }
    });
    inp.addEventListener("pointerdown", (e) => e.stopPropagation());
    inp.addEventListener("focus", () => inp.select());
  }
  // a digit typed while drawing goes straight into the size on the ghost
  BL.setType((ch) => {
    const want = ch === "next" ? "b" : document.activeElement && document.activeElement.parentNode && document.activeElement.parentNode._f === "b" ? "b" : "a",
      d = fieldOf(want) || fieldOf("a");
    if (!d) return;
    const inp = d.firstChild;
    if (ch === "next") return (inp.focus(), inp.select());
    typed[d._f] = (document.activeElement === inp ? typed[d._f] : "") + ch;
    inp.value = typed[d._f];
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
    sendTyped();
  });
  for (const m of measEls) m.lastChild.addEventListener("click", () => (BL.measClear(m._n), back()));

  let barKey = "",
    uiV = -1,
    ovV = -1,
    lastCam = NaN,
    typedV = -1,
    px = -1,
    py = -1,
    cursor = "";
  function frame() {
    if (!B.on) return void (sched.hidden || (sched.hidden = true), dpanel.hidden || (dpanel.hidden = true), (uiV = -1));
    if (uiV !== B.uiVer) {
      uiV = B.uiVer;
      const v = BL.view();
      renderOpts(v);
      text($("bhint"), v.hint);
      for (const b of pieces.children) b.dataset.piece && b.setAttribute("aria-pressed", b.dataset.piece === v.top ? "true" : "false");
      $("bundo").disabled = !v.undo;
      $("bredo").disabled = !v.redo;
      $("bsnap").setAttribute("aria-pressed", v.snap ? "true" : "false");
      $("bfree").setAttribute("aria-pressed", v.free ? "true" : "false");
      text($("blname"), v.levelName);
      $("bstop").hidden = !v.busy;
      $("bstop").children[1].textContent = v.busy === "chain" ? "Finish" : v.busy === "copy" || v.busy === "move" ? "Put down" : "Stop";
      renderSched(v.sched);
      bar.classList.toggle("fold", !!v.fold);
      $("bfold").setAttribute("aria-expanded", v.fold ? "false" : "true");
      // how much of the view the bar covers: build mode frames the site in what is left above it
      // (a steady figure: the bar with one row of options, whatever tool is in hand, so the view does not bob about)
      const k = (v.fold ? "f" : "o") + window.innerWidth + "x" + window.innerHeight;
      if (barKey !== k) {
        barKey = k;
        const r = bar.getBoundingClientRect();
        B.barH = window.innerHeight - r.bottom + $("bhead").offsetHeight + $("bmain").offsetHeight + (v.fold ? 22 : 66);
      }
    }
    if ((B.typedV || 0) !== typedV) ((typedV = B.typedV || 0), (typed.a = typed.b = ""));
    const m = G.camera.matrixWorld.elements,
      cam = m[12] + m[13] * 3 + m[14] * 7 + m[0] * 11 + m[5] * 13 + m[10] * 17 + m[8] * 19,
      ov = B.ov,
      moved = cam !== lastCam || ovV !== B.ovVer;
    if (moved) {
      lastCam = cam;
      ovV = B.ovVer;
      dimEls.forEach((d, n) => {
        const q = ov.dims[n];
        show(d, !!q);
        if (!q) return void (d._f = "");
        const inp = d.firstChild,
          editing = q.field && typed[q.field] !== "";
        d._f = q.field;
        d.classList.toggle("field", !!q.field);
        if (q.field) {
          if (!editing && document.activeElement !== inp) {
            const s = String(Math.round(q.val * 100) / 100);
            if (inp.value !== s) inp.value = s;
          }
          text(d.children[1], q.unit);
          text(d.children[2], "");
          text(d.lastChild, n === 0 ? (B.ptr.touch ? "tap to type" : "type for exact") : "");
        } else (text(d.children[1], ""), text(d.children[2], q.text), text(d.lastChild, ""));
        place(d, q.x, q.y, q.z, 0, -18);
        // keep the size clear of the cursor
        if (Math.hypot(d._x - B.ptr.x, d._y - B.ptr.y) < 46) ((d._y -= 44), (d.style.transform = "translate(" + d._x + "px," + d._y + "px)"));
      });
      show(snapEl, !!ov.snap);
      if (ov.snap) {
        place(snapEl, ov.snap.x, ov.snap.y, ov.snap.z);
        if (snapEl._k !== ov.snap.type) ((snapEl._k = ov.snap.type), (snapEl.className = "k-" + ov.snap.type));
        text(snapEl.lastChild, ov.snap.text);
      }
      handleEls.forEach((d, n) => {
        const q = ov.handles[n];
        show(d, !!q);
        if (!q) return;
        const cls = "bhandle" + (q[4] ? " oh-" + q[4] : "");
        if (d._c !== cls) ((d._c = cls), (d.className = cls));
        place(d, q[0], q[1], q[2]);
      });
      measEls.forEach((d, n) => {
        const q = ov.meas[n];
        show(d, !!q);
        if (!q) return;
        d._n = q.n;
        text(d.firstChild, q.text);
        show(d.lastChild, q.n >= 0);
        place(d, q.x, q.y, q.z, 0, -14);
      });
      portEls.forEach((d, n) => {
        const q = ov.ports[n];
        show(d, !!q);
        d._q = q || null;
        if (!q) return;
        const cls = "bport t-" + q.type + (q.from ? " on" : "") + (q.sel ? " sel" : "");
        if (d._c !== cls) ((d._c = cls), (d.className = cls));
        text(d.firstChild, q.text || "");
        place(d, q.p[0], q.p[1], q.p[2]);
      });
      show(marq, !!ov.marq);
      if (ov.marq) {
        const q = ov.marq;
        marq.style.cssText = "left:" + Math.min(q.x0, q.x1) + "px;top:" + Math.min(q.y0, q.y1) + "px;width:" + Math.abs(q.x1 - q.x0) + "px;height:" + Math.abs(q.y1 - q.y0) + "px";
      }
      show(lb, !!B.label);
      text(lb, B.label);
      lb.classList.toggle("bad", B.labelBad);
    }
    if (B.label && (px !== B.ptr.x || py !== B.ptr.y || moved)) {
      px = B.ptr.x;
      py = B.ptr.y;
      // beside the cursor, above the finger, and never under the bar
      const top = bar.getBoundingClientRect().top,
        x = Math.min(px + 18, window.innerWidth - lb.offsetWidth - 8),
        y = Math.min(B.ptr.touch ? py - 46 : py + 20, top - 34);
      lb.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
    }
    if (!dpanel.hidden) {
      const top = Math.round(window.innerHeight - bar.getBoundingClientRect().top + 8);
      if (dpanel._b !== top) ((dpanel._b = top), (dpanel.style.bottom = top + "px"));
    }
    if (B.on === false && !dpanel.hidden) dpanel.hidden = true;
    // over a door or window's edge handle: the resize arrows
    let edge = B.ores ? (B.ores.k === "l" || B.ores.k === "r" ? "ew-resize" : "ns-resize") : "";
    if (!edge && B.ov.handles && B.ov.handles.length && B.ov.handles[0][4] && !B.ptr.touch)
      for (const d of handleEls) if (!d.hidden && Math.hypot(d._x - B.ptr.x, d._y - B.ptr.y) < 13) edge = d.className.includes("oh-ew") ? "ew-resize" : "ns-resize";
    const want = edge || (B.tool === "select" ? (B.move ? "grabbing" : B.hoverId ? "pointer" : "default") : B.tapMode ? "copy" : B.fover ? "grab" : "crosshair");
    if (want !== cursor) canvas.style.cursor = cursor = want;
  }
  B.frameHook = frame;
})();
