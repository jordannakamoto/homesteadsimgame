/* Build mode's interface: the bar (which tool), the tray above it (what kind the next click draws), the inspector
   drawer (every property with exact numbers), and what is drawn over the view (live dimensions with their typed fields,
   the snap marker, wall handles, measurements). It only draws what window.__build.view() describes and reports clicks
   through window.__build.choose(). */
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
    eye: '<path d="M2.5 12s3.6-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.6 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    list: '<path d="M6 4h12v16H6zM9 8h6M9 12h6M9 16h4"/>',
    close: '<path d="M7 7l10 10M17 7L7 17"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    right: '<path d="M9.5 6l6 6-6 6"/>',
    warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.3v.2"/>',
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
  // Three surfaces, each with one job (docs/design/plan-mode-redesign.md section 2): the bar says which tool, the tray
  // above it (#bopts) what kind of thing the next click draws, and the inspector (#bdesign, a drawer on the right) every
  // property with its exact number. A slim hint row sits on top: the first-run chips, one sentence, the selection's
  // actions. Nine slots: More and Inside are group slots with a flyout (#bfly) of their members.
  bar.innerHTML =
    '<div id="bhead"><div id="bcoach" role="group" aria-label="Your first house" hidden></div><span id="bhint" aria-live="polite"></span><span id="bfit" role="status" hidden></span><button id="bstop" class="ui-btn ui-btn--go" type="button" hidden>' + svg(I.stop, 14) + '<span>Stop</span><kbd>Esc</kbd></button><span class="grow"></span><div id="bacts" role="group" aria-label="Selection"></div></div>' +
    '<div id="bopts" role="group" aria-label="What the next click draws"></div><div id="bdecor" role="group" aria-label="Pieces" hidden></div>' +
    '<div id="bmain"><div id="bpieces" role="group" aria-label="Build tools"></div><div id="baids">' +
    '<button id="bundo" class="ui-btn ui-btn--icon" type="button" title="Undo (Ctrl+Z)" aria-label="Undo">' + svg(I.undo, 18) + "</button>" +
    '<button id="bredo" class="ui-btn ui-btn--icon" type="button" title="Redo (Ctrl+Shift+Z)" aria-label="Redo">' + svg(I.redo, 18) + "</button>" +
    '<button id="bsnap" class="ui-btn ui-btn--icon" type="button" aria-pressed="true" aria-label="Snap" title="Snap to the grid, to ends, middles and walls, and to round angles ( / ). Hold Ctrl to place freely.">' + svg(I.snap, 18) + "</button>" +
    '<span class="sep" aria-hidden="true"></span>' +
    '<div id="blevel" class="ui-seg" role="group" aria-label="Storey (Page Up, Page Down)"></div>' +
    '<button id="broofs" class="ui-btn" type="button" aria-pressed="false" title="Show or lift away the roofs">' + svg(I.eye, 17) + "<span>Roofs</span></button>" +
    '<span class="sep" aria-hidden="true"></span>' +
    '<button id="bsched" class="ui-btn" type="button" aria-pressed="false" title="Materials: what the plan needs, stage by stage, and what it costs">' + svg(I.list, 18) + '<span class="name">Materials</span><b class="tot" hidden></b></button>' +
    '<button id="bdone" class="ui-slot" type="button" title="Leave build mode (B)">' + svg(I.done, 20) + '<span class="name">Done</span><span class="key ui-key">B</span></button></div></div>';
  const pieces = $("bpieces"),
    TOOLS = BL.view().tools,
    letterOf = (t) => t.letter || BL.TOOL_LETTER[t.id] || "",
    toolOf = (id) => TOOLS.find((t) => t.id === id),
    // the group slots and their members, in the bar's order
    GRP = { more: { name: "More", tools: TOOLS.filter((t) => t.cat === "more") }, inside: { name: "Inside", tools: TOOLS.filter((t) => t.cat === "inside") } },
    lastOf = { more: GRP.more.tools[0].id, inside: GRP.inside.tools[0].id },
    groupOfTool = (id) => (GRP.more.tools.some((t) => t.id === id) ? "more" : GRP.inside.tools.some((t) => t.id === id) ? "inside" : "");
  const slotTitle = (t) => t.name + " (" + letterOf(t) + ")" + (t.tip ? ". " + t.tip : "");
  const slotInner = (t, caret) => svg(I[t.id], 24) + '<span class="name">' + esc(t.name) + '</span><span class="key ui-key">' + esc(letterOf(t)) + "</span>" + (caret ? '<span class="caret" aria-hidden="true"></span>' : "");
  {
    let html = "";
    for (const [n, cluster] of [["select"], ["shell", "door", "window"], ["more", "inside"], ["remove"]].entries()) {
      if (n) html += '<span class="sep" aria-hidden="true"></span>';
      for (const cat of cluster) {
        if (GRP[cat]) {
          const t = toolOf(lastOf[cat]);
          html += '<button type="button" data-group="' + cat + '" data-cur="' + t.id + '" aria-pressed="false" aria-haspopup="menu" aria-expanded="false" title="' + esc(GRP[cat].name + ": " + GRP[cat].tools.map((x) => x.name + " " + letterOf(x)).join(", ") + ". Click again for the list.") + '">' + slotInner(t, true) + "</button>";
        } else for (const t of TOOLS.filter((x) => x.cat === cat)) html += '<button type="button" data-piece="' + t.id + '" title="' + esc(slotTitle(t)) + '" aria-pressed="false">' + slotInner(t) + "</button>";
      }
    }
    pieces.innerHTML = html;
  }
  const back = () => canvas.focus();
  // a group slot shows the member last used; it picks that one, and on the pressed slot (or a long press) lists them all
  const fly = document.createElement("div");
  fly.id = "bfly";
  fly.hidden = true;
  fly.setAttribute("role", "menu");
  document.body.appendChild(fly);
  let flyFor = "",
    flyTop = "",
    holdT = 0,
    held = false;
  function flyClose() {
    if (fly.hidden) return;
    fly.hidden = true;
    const s = pieces.querySelector('[data-group="' + flyFor + '"]');
    s && s.setAttribute("aria-expanded", "false");
    flyFor = "";
  }
  function flyOpen(gname) {
    const slot = pieces.querySelector('[data-group="' + gname + '"]'),
      top = BL.view().top;
    flyFor = gname;
    flyTop = top;
    fly.innerHTML =
      '<div class="bfh">' + esc(GRP[gname].name) + '</div><div class="bfi">' +
      GRP[gname].tools.map((t) => '<button type="button" role="menuitemradio" data-piece="' + t.id + '" aria-pressed="' + (t.id === top) + '" title="' + esc(slotTitle(t)) + '">' + svg(I[t.id], 28) + '<span class="name">' + esc(t.name) + '</span><span class="key ui-key">' + esc(letterOf(t)) + "</span></button>").join("") +
      "</div>";
    fly.hidden = false;
    slot.setAttribute("aria-expanded", "true");
    const r = slot.getBoundingClientRect(),
      w = fly.offsetWidth;
    fly.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))) + "px";
    fly.style.bottom = Math.round(window.innerHeight - r.top + 14) + "px";
  }
  fly.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-piece]");
    if (!b) return;
    flyClose();
    BL.setTool(b.dataset.piece);
    back();
  });
  pieces.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.piece) return (flyClose(), BL.setTool(b.dataset.piece), back());
    const gname = b.dataset.group;
    if (!gname) return;
    if (held) return void (held = false);
    if (flyFor === gname) return flyClose();
    if (b.getAttribute("aria-pressed") === "true") return flyOpen(gname);
    flyClose();
    BL.setTool(lastOf[gname]);
    back();
  });
  pieces.addEventListener("pointerdown", (e) => {
    const b = e.target.closest("button[data-group]");
    if (!b) return;
    held = false;
    clearTimeout(holdT);
    holdT = setTimeout(() => ((held = true), flyOpen(b.dataset.group)), 450);
  });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) pieces.addEventListener(ev, () => clearTimeout(holdT));
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!fly.hidden && !fly.contains(e.target) && !e.target.closest("#bpieces [data-group]")) flyClose();
    },
    true,
  );
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && !fly.hidden) (flyClose(), e.stopImmediatePropagation(), e.preventDefault());
    },
    true,
  );
  const press = (id, what, v) => $(id).addEventListener("click", () => (BL.choose(what, v), back()));
  press("bundo", "undo");
  press("bredo", "redo");
  press("bsnap", "snap");
  press("bdone", "done");
  press("bstop", "stop");
  press("broofs", "roofs");
  press("bsched", "sched");
  // the storeys that exist, the cellar (dim until one is dug) and one empty storey above the top
  $("blevel").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-l]");
    b && (BL.choose("level:set", +b.dataset.l), back());
  });
  // the first-run chips: a room, a door, a roof, then Done. A chip picks its tool.
  let coachV = [];
  $("bcoach").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-n]"),
      c = b && coachV[+b.dataset.n];
    if (!c) return;
    c.tool ? BL.setTool(c.tool) : BL.choose("done");
    back();
  });
  // the schedule: the bill of materials by stage, in a drawer at the side
  const sched = document.createElement("div");
  sched.id = "bschedp";
  sched.className = "panel ui-panel ui-panel--side";
  sched.hidden = true;
  sched.innerHTML = '<div class="ui-panel__head">' + svg(I.list, 24) + '<div class="bph"><h2>Materials</h2><small></small></div><button type="button" class="ui-close" data-x="sched" aria-label="Close the materials" title="Close">' + svg(I.close, 18) + '</button></div><div class="bschb"></div><div class="bschf"></div>';
  document.body.appendChild(sched);
  const money = (v) => "$" + Math.round(v).toLocaleString("en-US");
  let schedHtml = "";
  function renderSched(d, v) {
    sched.hidden = !d;
    $("bsched").setAttribute("aria-pressed", d ? "true" : "false");
    if (!d) return void (schedHtml = "");
    const body =
      d.stages.length
        ? d.stages
            .map((st) => '<section><h3><span>' + esc(st.name) + "</span><small>" + (st.built === st.of ? "built" : st.built ? st.built + " of " + st.of + " built" : "planned") + "</small><b>" + money(st.cost) + "</b></h3>" + st.lines.map((ln) => '<div class="ln" title="' + esc(ln.why) + '"><span>' + esc(ln.label) + "</span><i>" + esc(ln.qty) + "</i><b>" + (ln.missing ? "not sold yet" : money(ln.cost)) + "</b><em>" + esc(ln.why) + "</em></div>").join("") + "</section>")
            .join("")
        : '<p class="none">Nothing to list yet. Draw a room, or set down a plan.</p>',
      foot =
        (d.stages.length ? '<div class="tot"><span>Total</span><b>' + money(d.total) + "</b></div>" : "") +
        (v.sandbox ? '<p class="bsbx">Sandbox: built as you draw</p>' : '<button type="button" class="ui-btn ui-btn--go" data-x="order">' + svg(I.done, 18) + "<span>Order materials</span></button>"),
      html = d.title + "\u0000" + body + "\u0000" + foot;
    if (html === schedHtml) return;
    schedHtml = html;
    sched.querySelector(".bph small").textContent = d.title;
    const b = sched.querySelector(".bschb"),
      top = b.scrollTop;
    b.innerHTML = body;
    b.scrollTop = top;
    sched.querySelector(".bschf").innerHTML = foot;
  }
  sched.addEventListener("click", (e) => {
    const x = e.target.closest("[data-x]");
    if (!x) return;
    if (x.dataset.x === "sched") return (BL.choose("sched"), back());
    // order: leave plan mode and open the Build panel, where the plan's materials are bought
    BL.choose("sched");
    BL.choose("done");
    const cvb = $("cvb"),
      cv = $("cv");
    cvb && (!cv || cv.hidden) && cvb.click();
  });

  /* ---------- the tray (what the next click draws) and the inspector (everything else, with exact numbers) ---------- */
  const opts = $("bopts"),
    row2 = $("bdecor"),
    // the inspector: a drawer on the right, above the bar, clear of the wall being worked on. The same drawer for the
    // next piece and for the selected one; it is also the door and window designer.
    dpanel = document.createElement("div");
  dpanel.id = "bdesign";
  dpanel.className = "panel ui-panel ui-panel--side";
  dpanel.hidden = true;
  dpanel.setAttribute("role", "region");
  // head, then the door and window designer's stage (sticky: outside the scrolling body), the fit line, the designer's
  // tabs, the body and the foot
  dpanel.innerHTML =
    '<div class="ui-panel__head"><span class="bdic"></span><div class="bph"><h2></h2><small></small></div><button type="button" class="ui-close" aria-label="Close the details" title="Close (More opens it again)">' + svg(I.close, 18) + "</button></div>" +
    '<div id="bdstage" hidden></div><div id="bdfit" role="status" hidden></div><div id="bdtabs" class="ui-tabs" role="tablist" aria-label="Designer" hidden></div><div id="bdbody"></div><div id="bdfoot" hidden></div>';
  document.body.appendChild(dpanel);
  const dbody = $("bdbody"),
    dfit = $("bdfit"),
    dfoot = $("bdfoot"),
    dstage = $("bdstage"),
    dtabs = $("bdtabs");
  dpanel.querySelector(".ui-close").addEventListener("click", () => (BL.choose("insp"), back()));
  let groups = [],
    lastV = null,
    tabTool = "";
  const tabSel = {};
  const keyHint = (k) => (k ? "<kbd>" + esc(k) + "</kbd>" : "");
  const same = (a, b) => a === b || (a !== null && b !== null && typeof a === "object" && typeof b === "object" && JSON.stringify(a) === JSON.stringify(b));
  // a tray or inspector card: the picture (an opening's drawing when the item names one, else its icon) and its name.
  // Opening drawings are made once per type (or recent design) and size, then reused.
  const thumbs = new Map();
  function pic(x, size = 30) {
    if (x.svg) return x.svg;   // a drawing view() made itself (the stair types, by __stairsGeo)
    if ((x.thumb || x.spec) && window.__openingPreview) {
      const k = (x.spec ? JSON.stringify(x.spec) : x.thumb) + "@" + size;
      if (!thumbs.has(k)) {
        let h = "";
        try {
          h = window.__openingPreview.draw(x.spec || x.thumb, { size: "thumb", width: size, height: size, label: x.name });
        } catch (e) {}
        thumbs.set(k, h);
      }
      if (thumbs.get(k)) return thumbs.get(k);
    }
    return I[x.icon] ? svg(I[x.icon], size > 30 ? 26 : 22) : "";
  }
  const card = (x, n, m, pressed) => '<button type="button" class="btile bcard" data-g="' + n + '" data-i="' + m + '" title="' + esc(x.name) + '" aria-label="' + esc(x.name) + '" aria-pressed="' + pressed + '">' + pic(x) + '<span class="nm">' + esc(x.name) + "</span></button>";
  // a catalogue card in the tray (a door or window type, or a recent design): its drawing beside its whole name
  function ocard(x, n, m, pressed) {
    const sz = /^(.*?)\s+(\d+(?:\.\d+)?\s*×\s*\d+(?:\.\d+)?)$/.exec(x.name || ""),
      name = sz ? sz[1] : x.name;
    return '<button type="button" class="btile bcard bocard" data-g="' + n + '" data-i="' + m + '" title="' + esc(x.name + (x.note ? ". " + x.note : "")) + '" aria-label="' + esc(x.name) + '" aria-pressed="' + pressed + '"><span class="th">' + pic(x, 40) + '</span><span class="nm' + (sz ? " sz" : "") + '"><b>' + esc(name) + "</b>" + (sz ? "<small>" + esc(sz[2]) + "</small>" : "") + "</span></button>";
  }
  function groupHtml(g, n, inTray) {
    const lab = (extra) => '<span class="blab">' + esc(g.label || "") + (extra !== undefined ? ' <b class="bval">' + esc(extra) + "</b>" : "") + (inTray ? "" : keyHint(g.key)) + "</span>";
    const cur = g.items ? g.items.find((x) => same(x.v, g.value)) : null;
    const tip = inTray && g.key ? ' title="' + esc((g.label || "") + " (" + g.key + ")") + '"' : "";
    if (g.type === "num")
      return '<div class="bgroup bnumg">' + lab() + '<div class="bitems bnumi ui-step"><button type="button" class="bchip" data-g="' + n + '" data-i="-1" aria-label="Less">' + svg(I.minus, 13) + '</button><input type="text" inputmode="decimal" autocomplete="off" data-g="' + n + '" value="' + esc(g.value) + '" aria-label="' + esc(g.label) + '"><span class="bu u">' + esc(g.unit || "") + '</span><button type="button" class="bchip" data-g="' + n + '" data-i="1" aria-label="More">' + svg(I.plus, 13) + "</button></div>" + (g.note ? '<span class="bnote' + (g.bad ? " bad" : "") + '">' + esc(g.note) + "</span>" : "") + "</div>";
    if (g.type === "badges") return '<div class="bgroup bbadges">' + g.items.map((x) => '<span class="bbadge ui-tag' + (x.k ? " k-" + x.k : "") + '"' + (x.title ? ' title="' + esc(x.title) + '"' : "") + ">" + esc(x.text) + "</span>").join("") + "</div>";
    if (g.type === "info") return '<div class="bgroup binfo"><span class="btitle">' + esc(g.title) + '</span><span class="bnum">' + esc(g.text) + "</span></div>";
    if (g.type === "swatches") return '<div class="bgroup"' + tip + ">" + lab(cur ? cur.name : g.value === null ? "mixed" : "") + '<div class="bitems">' + g.items.map((x, m) => '<button type="button" class="bsw" data-g="' + n + '" data-i="' + m + '" title="' + esc(x.name) + '" aria-label="' + esc(x.name) + '" aria-pressed="' + same(x.v, g.value) + '">' + swatch(x.sw) + "</button>").join("") + "</div></div>";
    // tiles are named cards: a picture and its name, the chosen one marked
    if (g.type === "tiles") return '<div class="bgroup"' + tip + ">" + lab(cur ? cur.name : g.value === null ? "mixed" : "") + '<div class="bitems bcards">' + g.items.map((x, m) => card(x, n, m, same(x.v, g.value))).join("") + "</div></div>";
    if (g.type === "chips") return '<div class="bgroup" data-id="' + esc(g.id || "") + '"' + tip + ">" + (g.label ? lab(cur && cur.note ? cur.note : undefined) : "") + '<div class="bitems ui-seg">' + g.items.map((x, m) => '<button type="button" class="bchip" data-g="' + n + '" data-i="' + m + '" aria-pressed="' + same(x.v, g.value) + '"' + (x.note ? ' title="' + esc(x.note) + '"' : "") + ">" + esc(x.name) + "</button>").join("") + "</div></div>";
    if (g.type === "stepper") return '<div class="bgroup">' + lab() + '<div class="bitems bstep ui-step"><button type="button" class="bchip" data-g="' + n + '" data-i="-1" aria-label="Less">' + svg(I.minus, 14) + '</button><span class="bnum n">' + esc(g.text) + '</span><button type="button" class="bchip" data-g="' + n + '" data-i="1" aria-label="More">' + svg(I.plus, 14) + "</button></div></div>";
    if (g.type === "toggle") return '<div class="bgroup"><span class="blab">&nbsp;</span><div class="bitems"><button type="button" class="btile" data-g="' + n + '" aria-pressed="' + !!g.on + '" title="' + esc(g.title || g.name) + '">' + svg(I[g.icon], 17) + "<span>" + esc(g.name) + "</span></button></div></div>";
    if (g.type === "action") return '<div class="bgroup"><span class="blab">' + (g.key && !inTray ? keyHint(g.key) : "&nbsp;") + '</span><div class="bitems"><button type="button" class="btile' + (g.danger ? " danger" : "") + '" data-g="' + n + '" title="' + esc((g.title || g.name) + (g.key ? " (" + g.key + ")" : "")) + '">' + svg(I[g.icon], 17) + "<span>" + esc(g.name) + "</span></button></div></div>";
    if (g.type === "field") return '<div class="bgroup">' + lab() + '<div class="bitems bfield" title="' + esc(g.title || "") + '"><input type="text" inputmode="decimal" autocomplete="off" data-g="' + n + '" value="' + esc(g.value) + '" aria-label="' + esc(g.label) + '"' + (g.locked ? " disabled" : "") + "><span>" + esc(g.unit) + "</span></div></div>";
    if (g.type === "select") return '<div class="bgroup">' + lab() + '<div class="bitems bfield" title="' + esc(g.title || "") + '"><select data-g="' + n + '" aria-label="' + esc(g.label) + '">' + g.items.map((x, m) => '<option value="' + m + '"' + (x.v === g.value ? " selected" : "") + ">" + esc(x.name) + "</option>").join("") + "</select></div></div>";
    return "";
  }
  // several tile groups in a row with one id (a catalogue by family): one row of cards under family tabs
  function tabbedHtml(run, toolKey) {
    const key = toolKey + ":" + run[0].g.id;
    const holder = run.find((r) => "value" in r.g),
      val = holder ? holder.g.value : undefined;
    let a = tabSel[key];
    if (a === undefined || a >= run.length) {
      a = run.findIndex((r) => r.g.cur);
      if (a < 0) a = run.findIndex((r) => r.g.items.some((x) => same(x.v, val)));
      if (a < 0) a = 0;
    }
    const { g, n } = run[a],
      cat = g.id === "otype";   // the door or window catalogue: drawings and whole names
    return (
      '<div class="bgroup btabbed' + (cat ? " bocat" : "") + '"><div class="blab btabl" role="tablist">' +
      run.map((r, k) => '<button type="button" role="tab" data-tab="' + esc(key) + '" data-k="' + k + '" aria-selected="' + (k === a) + '"' + (r.g.note ? ' title="' + esc(r.g.note) + '"' : "") + ">" + esc(r.g.label || "") + "</button>").join("") +
      (cat && g.note ? '<span class="btabn">' + esc(g.note) + "</span>" : "") +
      '</div><div class="bitems bcards">' + g.items.map((x, m) => (cat ? ocard : card)(x, n, m, same(x.v, val))).join("") + "</div></div>"
    );
  }
  const setHtml = (el, html) => {
    if (el._h === html) return false;
    el._h = html;
    el.innerHTML = html;
    return true;
  };
  // the door and window designer (docs/design/plan-mode-redesign.md section 3.1): a stage drawn to scale with handles, a
  // door's plan view, the fit line, tabs (Size & place, Style, Finish) and the foot. Its sizes are fixed so a drag in the
  // stage can be turned back into metres from the drawing's own data-k, data-ox and data-oy.
  const stageW = (g) => (g.plan ? 220 : 356),
    stageH = (g) => (g.plan ? 168 : 172),
    dtabSel = {};
  let stageV = null,
    stageKey = "",
    stageCache = "";
  function stageHtml(g) {
    if (g.kind === "stairs") return g.svg ? '<div class="bstrow"><div class="bstel">' + g.svg + "</div></div>" : "";   // the stair's side view, drawn by __stairsGeo
    const P = window.__openingPreview;
    if (!P || !g.spec) return "";
    try {
      const sel = g.mode === "sel",
        win = g.kind === "window",
        tip = win ? (sel ? "Drag an edge to resize, the middle to move" : "Drag an edge to resize, the middle to raise") : sel ? "Drag an edge to resize, the middle to slide" : "Drag an edge to resize";
      let h = '<div class="bstrow"><div class="bstel">' + P.draw(g.spec, { size: "stage", wall: g.wall, at: g.at, hand: g.hand, anchor: g.anchor, handles: true, width: stageW(g), height: stageH(g) }) + "</div>",
        cap = "";
      // a door's plan view beside it: its quarters are the buttons for which way it opens
      if (g.plan) {
        const pl = P.plan(g.spec, g.hand, { width: 132, height: stageH(g) });
        if (pl) {
          const hs = P.hands(g.spec),
            on = hs.find((c) => (c.flip === null || +c.flip === +!!g.hand.flip) && (c.out === null || +c.out === +!!g.hand.out));
          h += '<div class="bstpl">' + pl + "</div>";
          cap = on ? on.label : g.how || "";
        }
      }
      return h + '</div><div class="bststrip"><span class="bsttip">' + esc(tip) + "</span>" + (cap ? '<span class="bstcap" title="Click a quarter of the plan to change it">' + esc(cap) + "</span>" : "") + "</div>";
    } catch (e) {
      return "";
    }
  }
  function renderOpts(v) {
    lastV = v;
    groups = v.groups;
    const toolKey = v.tool + (v.sel ? ":sel" : "");
    if (tabTool !== toolKey) {
      tabTool = toolKey;
      for (const k in tabSel) delete tabSel[k];
    }
    const tray = [],
      second = [],
      inspL = [],
      foot = [],
      acts = [],
      ends = [];
    let swatches = false,
      stageG = null;
    for (let n = 0; n < groups.length; n++) {
      const g = groups[n];
      if (g.acts || (g.type === "action" && g.id && g.id.startsWith("s:") && g.tier)) {
        acts.push('<button type="button" class="bchip' + (g.danger ? " danger" : "") + '" data-g="' + n + '" title="' + esc(g.title || g.name) + (g.key ? " (" + esc(g.key) + ")" : "") + '">' + svg(I[g.icon], 15) + "<span>" + esc(g.name) + "</span></button>");
        continue;
      }
      if (g.id === "roofs") continue;   // the bar's Roofs toggle
      if (g.tier || g.row === 2) {
        if (g.id === "paint" || g.id === "pick") {
          ends.push('<button type="button" class="btool" data-g="' + n + '" aria-pressed="' + !!g.on + '" title="' + esc(g.title || g.name) + '" aria-label="' + esc(g.name) + '">' + svg(I[g.icon], 20) + "</button>");
          continue;
        }
        const arr = g.row === 2 ? second : tray;
        if (g.type === "swatches") swatches = true;
        // a catalogue by family: consecutive tile groups that share an id
        if (g.type === "tiles" && groups[n + 1] && groups[n + 1].id === g.id && groups[n + 1].type === "tiles" && (groups[n + 1].tier || groups[n + 1].row === 2)) {
          const run = [];
          while (groups[n] && groups[n].id === g.id && groups[n].type === "tiles") run.push({ g: groups[n], n: n++ });
          n--;
          arr.push(tabbedHtml(run, toolKey));
        } else if (g.id === "o:recent") arr.push('<div class="bgroup bocat brecent"><span class="blab">' + esc(g.label || "Recent") + '</span><div class="bitems bcards">' + g.items.map((x, m) => ocard(x, n, m, false)).join("") + "</div></div>");
        else arr.push(groupHtml(g, n, true));
      } else if (g.type === "stage") stageG = g;
      else {
        const h = groupHtml(g, n, false);
        if (!h) continue;
        if (g.foot) foot.push(h);
        else inspL.push({ g, h });
      }
    }
    const I_ = v.inspector || { has: false, open: false };
    // the tray's end: Paint and Pick when there is a material to paint with, then More, which opens the inspector
    const end =
      (swatches ? ends.join("") + '<span class="sep" aria-hidden="true"></span>' : "") +
      (I_.has ? '<button type="button" id="bmore" class="ui-btn" aria-expanded="' + !!I_.open + '" aria-pressed="' + !!I_.open + '" title="Every setting, with exact numbers (double-click a piece for its own)">' + svg(I.sliders, 18) + "<span>More</span>" + svg(I.right, 14) + "</button>" : "");
    setHtml($("bacts"), acts.join(""));
    setHtml(opts, tray.join("") + (end ? '<div class="btrayend">' + end + "</div>" : ""));
    opts.hidden = !tray.length;
    opts.classList.toggle("bocats", tray.some((h) => h.includes(" bocat")));
    setHtml(row2, second.join(""));
    row2.hidden = !second.length;
    // the inspector
    const show = !!(I_.open && I_.has && (inspL.length || stageG));
    dpanel.hidden = !show;
    stageV = show ? stageG : null;
    dpanel.classList.toggle("bdes", !!stageV);
    if (stageV) dpanel.dataset.kind = stageV.kind;
    // the fit line: does the next or selected opening fit, and if not, what was done and the fixes
    const fit = v.fit,
      fitHtml = fit && fit.text ? '<span class="bfitt">' + svg(fit.ok ? I.done : I.warn, 15) + "<span>" + esc(fit.text) + "</span></span>" + (fit.fixes && fit.fixes.length ? '<span class="bfixes">' + fit.fixes.map((x, k) => '<button type="button" class="bchip bfix" data-fix="' + k + '">' + svg(I.right, 13) + "<span>" + esc(x.label) + "</span></button>").join("") + "</span>" : "") : "";
    setHtml(dfit, show ? fitHtml : "");
    dfit.hidden = !show || !fitHtml;
    dfit.className = fit && !fit.ok ? "bad" : fit && fit.adjusted ? "adj" : "";
    setHtml($("bfit"), !show && fit && !fit.ok ? fitHtml : "");
    $("bfit").hidden = show || !fit || fit.ok;
    // the foot: Flip and Delete for a selected unit; the next one says where it goes
    setHtml(dfoot, show ? (stageV && stageV.mode !== "sel" ? '<span class="bdnext">' + svg(I.right, 14) + "<span>" + esc(stageV.next || "Click a wall to place it") + "</span></span>" : "") + foot.join("") : "");
    dfoot.hidden = !show || !foot.length;
    if (!show) return;
    const head = dpanel.firstChild;
    setHtml(head.firstChild, svg(I[I_.icon] || I.select, 22));
    const h2 = head.querySelector("h2"),
      sm = head.querySelector("small");
    h2.textContent !== I_.title && (h2.textContent = I_.title || "");
    sm.textContent !== (I_.sub || "") && (sm.textContent = I_.sub || "");
    dpanel.dataset.mode = I_.mode || "next";
    // the stage: kept out of the scrolling body so it stays in view (and keeps a drag's pointer while it redraws)
    if (stageV) {
      const k = JSON.stringify(stageV);
      if (k !== stageKey) ((stageKey = k), (stageCache = stageHtml(stageV)));
    }
    setHtml(dstage, stageV ? stageCache : "");
    dstage.hidden = !stageV;
    let body;
    if (stageV) {
      // tabs from the sections view() gives, in its order; the Preview section's facts go at the foot of Size & place
      const secs = [],
        about = [];
      for (const x of inspL) x.g.sec === "Preview" ? about.push(x.h) : x.g.sec && !secs.includes(x.g.sec) && secs.push(x.g.sec);
      let cur = dtabSel[stageV.kind];
      if (!secs.includes(cur)) cur = secs[0];
      setHtml(dtabs, secs.map((s) => '<button type="button" role="tab" data-dt="' + secs.indexOf(s) + '" aria-selected="' + (s === cur) + '">' + esc(s) + "</button>").join(""));
      dtabs.hidden = secs.length < 2;
      dtabs._secs = secs;
      // the tab's groups, in blocks: consecutive groups that share a `group` (height on the wall, along the wall) stand
      // together
      const blocks = [];
      let key = {};
      for (const x of inspL) {
        if (x.g.sec !== cur) continue;
        const k = x.g.group || (x.g.type === "info" ? "info" : "");
        if (k !== key) blocks.push({ k, hs: [] }), (key = k);
        blocks[blocks.length - 1].hs.push(x.h);
      }
      const blurb = stageV.blurb && stageV.blurb !== stageV.how ? stageV.blurb : "";
      if (cur === secs[0] && (about.length || blurb)) blocks.push({ k: "about", hs: [(blurb ? '<p class="bblurb">' + esc(blurb) + "</p>" : "") + about.join("")] });
      body = blocks.map((b) => '<section class="bsec bdblk' + (b.k ? " k-" + b.k : "") + '"><div class="bsecb">' + b.hs.join("") + "</div></section>").join("");
      dbody.setAttribute("role", "tabpanel");
    } else {
      dtabs.hidden = true;
      setHtml(dtabs, "");
      const inspS = new Map(),
        top = [];
      for (const x of inspL) x.g.sec ? (inspS.get(x.g.sec) || inspS.set(x.g.sec, []).get(x.g.sec)).push(x.h) : top.push(x.h);
      body = top.join("") + [...inspS].map(([name, hs]) => '<section class="bsec"><h3 class="bsech">' + esc(name) + '</h3><div class="bsecb">' + hs.join("") + "</div></section>").join("");
      dbody.removeAttribute("role");
    }
    const was = dbody.querySelector("input:focus"),
      top = dbody.scrollTop;
    if (setHtml(dbody, body)) {
      dbody.scrollTop = top;
      if (was) {
        const again = dbody.querySelector('input[data-g="' + was.dataset.g + '"]');
        again && again.focus();
      }
    }
  }
  // a designer tab
  dtabs.addEventListener("click", (e) => {
    const t = e.target.closest("[data-dt]");
    if (!t || !stageV || !dtabs._secs) return;
    dtabSel[stageV.kind] = dtabs._secs[+t.dataset.dt];
    dbody.scrollTop = 0;
    lastV && renderOpts(lastV);
  });
  dtabs.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const ts = [...dtabs.children],
      i = ts.findIndex((t) => t.getAttribute("aria-selected") === "true"),
      j = (i + (e.key === "ArrowRight" ? 1 : -1) + ts.length) % ts.length;
    e.preventDefault();
    e.stopPropagation();
    ts[j] && (ts[j].click(), dtabs.children[j] && dtabs.children[j].focus());
  });

  /* ---------- the stage's handles: drag an edge to resize, the middle to move. One choose per frame while a drag
     is live; widths, heights and places go in 5 cm steps (Ctrl: 1 cm), through the same ids as the steppers ---------- */
  let sdrag = null,
    sdragRaf = 0;
  const stageSvg = () => dstage.querySelector("svg.op-prev--stage");
  function stageM(x, y, el) {
    const r = el.getBoundingClientRect(),
      vb = el.viewBox.baseVal,
      k = +el.dataset.k,
      px = ((x - r.left) * vb.width) / r.width,
      py = ((y - r.top) * vb.height) / r.height;
    return { u: (px - +el.dataset.ox) / k, y: (+el.dataset.oy - py) / k };
  }
  // where the unit stands now, in metres along its run and above the floor, and its designer numbers
  function stageNow() {
    const v = BL.view(),
      g = v.groups.find((x) => x.type === "stage");
    if (!g || !window.__openingPreview) return null;
    const M = window.__openingPreview.metrics(g.spec, { size: "stage", wall: g.wall, at: g.at, width: stageW(g), height: stageH(g) }),
      num = (id) => {
        const x = v.groups.find((q) => q.id === id && q.type === "num");
        return x ? parseFloat(String(x.value).replace(",", ".")) : NaN;
      };
    return { g, uL: (M.x0 - M.ox) / M.k, uR: (M.x1 - M.ox) / M.k, yT: (M.oy - M.y0) / M.k, yB: (M.oy - M.y1) / M.k, w: num("w:w"), h: num("w:h"), an: g.anchor || "sill", sel: g.mode === "sel", win: g.kind === "window" };
  }
  function stageStep() {
    sdragRaf = 0;
    const D = sdrag,
      el = stageSvg();
    if (!D || !el) return;
    const p = stageM(D.x, D.y, el),
      S = D.s,
      st = (x) => (D.ctrl ? Math.round(x * 100) / 100 : Math.round(x * 20) / 20),
      r2 = (x) => Math.round(x * 100) / 100,
      out = [],
      send = (id, val) => out.push([id, val]),
      anY = (sill, head) => (S.an === "head" ? head : S.an === "centre" ? (sill + head) / 2 : sill),
      w0 = S.uR - S.uL,
      h0 = S.yT - S.yB;
    if (D.k === "l" || D.k === "r") {
      if (!isFinite(S.w)) return;
      // the opposite edge stays put (the next unit has no place yet: it grows about its middle)
      const want = D.k === "r" ? (S.sel ? p.u - S.uL : 2 * (p.u - (S.uL + S.uR) / 2)) : S.sel ? S.uR - p.u : 2 * ((S.uL + S.uR) / 2 - p.u),
        w = r2(st(S.w + want - w0));
      if (w <= 0) return;
      send("w:w", w);
      if (S.sel && D.k === "l") send("o:pos", r2(S.uR - (w0 + w - S.w)));
      else if (S.sel) send("o:pos", r2(S.uL));
    } else if (D.k === "t" || D.k === "b") {
      if (!isFinite(S.h)) return;
      const y = st(p.y),
        h = r2(st(S.h + (D.k === "t" ? y - S.yB : S.yT - y) - h0));
      if (h <= 0) return;
      send("w:h", h);
      // the other edge stays put: say where the anchored line is now
      if (S.win) {
        const sill = D.k === "t" ? S.yB : S.yT - (h0 + h - S.h),
          head = D.k === "t" ? S.yB + h0 + h - S.h : S.yT;
        if (!(D.k === "t" && S.an === "sill") && !(D.k === "b" && S.an === "head")) send("o:y", { anchor: S.an, y: r2(anY(sill, head)) });
      }
    } else if (D.k === "move") {
      if (S.sel) send("o:pos", r2(st(S.uL + p.u - D.u0)));
      if (S.win) send("o:y", { anchor: S.an, y: r2(st(anY(S.yB, S.yT) + p.y - D.y0)) });
    }
    // the same request as last frame changes nothing (and would only add steps to undo)
    const j = JSON.stringify(out);
    if (!out.length || j === D.sent) return;
    D.sent = j;
    for (const [id, val] of out) BL.choose(id, val);
  }
  dstage.addEventListener("pointerdown", (e) => {
    const h = e.target.closest("[data-h]"),
      el = stageSvg();
    if (!h || !el || e.button > 0) return;
    const s = stageNow();
    if (!s) return;
    e.preventDefault();
    const p = stageM(e.clientX, e.clientY, el);
    sdrag = { k: h.dataset.h, id: e.pointerId, x: e.clientX, y: e.clientY, u0: p.u, y0: p.y, s, sent: "", ctrl: e.ctrlKey || e.metaKey, n0: Array.isArray(B.undo) ? B.undo.length : -1 };
    try {
      dstage.setPointerCapture(e.pointerId);
    } catch (err) {}
    dstage.dataset.drag = sdrag.k;
  });
  dstage.addEventListener("pointermove", (e) => {
    if (!sdrag || e.pointerId !== sdrag.id) return;
    sdrag.x = e.clientX;
    sdrag.y = e.clientY;
    sdrag.ctrl = e.ctrlKey || e.metaKey;
    sdragRaf || (sdragRaf = requestAnimationFrame(stageStep));
  });
  const stageEnd = (e) => {
    if (!sdrag || e.pointerId !== sdrag.id) return;
    sdragRaf && cancelAnimationFrame(sdragRaf);
    e.type === "pointerup" && stageStep();
    // one drag is one step to undo
    const n0 = sdrag.n0;
    if (n0 >= 0 && B.undo.length > n0 + 1 && B.undo.length < 200) B.undo.splice(n0 + 1);
    sdrag = null;
    delete dstage.dataset.drag;
    back();
  };
  dstage.addEventListener("pointerup", stageEnd);
  dstage.addEventListener("pointercancel", stageEnd);
  const onPick = (e) => {
    const tab = e.target.closest("button[data-tab]");
    if (tab) return ((tabSel[tab.dataset.tab] = +tab.dataset.k), lastV && renderOpts(lastV));
    if (e.target.closest("#bmore")) return (BL.choose("insp"), back());
    const fix = e.target.closest("button[data-fix]");
    if (fix) return (BL.choose("o:fix", +fix.dataset.fix), back());
    const q = e.target.closest(".op-q");
    if (q) {
      const h = {};
      for (const k of ["flip", "out"]) if (q.dataset[k] !== undefined) h[k] = +q.dataset[k];
      return (BL.choose("o:hand", h), back());
    }
    const b = e.target.closest("button[data-g]");
    if (!b) return;
    const g = groups[+b.dataset.g];
    if (!g) return;
    BL.choose(g.id, g.type === "stepper" ? +b.dataset.i : g.type === "num" ? { step: +b.dataset.i } : g.items ? g.items[+b.dataset.i].v : undefined);
    back();
  };
  // pointing at a swatch or a card names it in the group's label
  const named = (e) => e.target.closest(".bsw, .btile[data-i]");
  for (const el of [opts, row2, $("bacts"), dbody, dfit, dfoot, $("bfit"), dstage]) {
    el.addEventListener("click", onPick);
    el.addEventListener("pointerover", (e) => {
      const b = named(e),
        val = b && b.closest(".bgroup").querySelector(".bval");
      if (val) val.textContent = b.title;
    });
    el.addEventListener("pointerout", (e) => {
      const b = named(e),
        g = b && groups[+b.dataset.g],
        val = b && b.closest(".bgroup").querySelector(".bval");
      if (!val || !g || !g.items) return;
      const cur = g.items.find((x) => x.v === g.value);
      val.textContent = cur ? cur.name : g.value === null ? "mixed" : "";
    });
    // typed properties: Enter sets, Esc puts the old number back
    el.addEventListener("keydown", (e) => {
      if (e.target.tagName !== "INPUT") return;
      e.stopPropagation();
      if (e.key === "Enter") e.target.blur();
      else if (e.key === "Escape") ((e.target.value = e.target.defaultValue), e.target.blur(), back());
    });
    el.addEventListener("change", (e) => {
      const g = groups[+e.target.dataset.g];
      if (!g) return;
      if (e.target.tagName === "SELECT") return (BL.choose(g.id, g.items[+e.target.value].v), back());
      if (e.target.tagName !== "INPUT") return;
      if (g.text) return (BL.choose(g.id, e.target.value), back());
      const v = parseFloat(e.target.value.replace(",", "."));
      isFinite(v) ? BL.choose(g.id, v) : (e.target.value = e.target.defaultValue);
      back();
    });
  }

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
    trayMax = 76,
    peekH = 0,
    uiV = -1,
    ovV = -1,
    lastCam = NaN,
    typedV = -1,
    px = -1,
    py = -1,
    cursor = "",
    levelsKey = "",
    coachKey = "";
  window.addEventListener("resize", () => ((uiV = -1), flyClose()));
  function renderBar(v) {
    // which slot is pressed; a group slot takes the face of the member in hand
    const g = groupOfTool(v.top);
    if (g && lastOf[g] !== v.top) {
      lastOf[g] = v.top;
      const s = pieces.querySelector('[data-group="' + g + '"]');
      s.dataset.cur = v.top;
      s.innerHTML = slotInner(toolOf(v.top), true);
    }
    for (const b of pieces.children) {
      if (b.tagName !== "BUTTON") continue;
      const on = b.dataset.piece ? b.dataset.piece === v.top : b.dataset.group === g;
      b.getAttribute("aria-pressed") !== String(on) && b.setAttribute("aria-pressed", String(on));
    }
    if (!fly.hidden && flyTop !== v.top) flyClose();
    $("bundo").disabled = !v.undo;
    $("bredo").disabled = !v.redo;
    $("bsnap").setAttribute("aria-pressed", v.snap ? "true" : "false");
    $("broofs").setAttribute("aria-pressed", v.roofs ? "true" : "false");
    const lk = JSON.stringify(v.levels);
    if (lk !== levelsKey) {
      levelsKey = lk;
      $("blevel").innerHTML = (v.levels || [])
        .map((l) => '<button type="button" data-l="' + l.l + '" aria-pressed="' + !!l.cur + '"' + (!l.has && l.l !== 0 ? ' class="dim"' : "") + ' title="' + esc(l.name === "+" ? "Start a storey above (Page Up)" : l.name === "Cellar" ? (l.has ? "The cellar" : "Dig a cellar: a storey below the ground") + " (Page Down)" : (l.l === 0 ? "The ground floor" : "Storey " + l.name) + (l.has ? "" : ": nothing here yet")) + '">' + (l.name === "+" ? svg(I.plus, 14) : esc(l.name)) + "</button>")
        .join("");
    }
    const tot = $("bsched").lastChild,
      tt = v.total ? money(v.total) : "";
    tot.hidden = !tt;
    text(tot, tt);
    const ck = JSON.stringify(v.coach);
    if (ck !== coachKey) {
      coachKey = ck;
      coachV = v.coach || [];
      const next = coachV.findIndex((c) => !c.done);
      $("bcoach").hidden = !v.coach;
      $("bcoach").innerHTML = coachV.map((c, n) => '<button type="button" class="bcoach' + (c.done ? " done" : "") + (n === next ? " next" : "") + '" data-n="' + n + '" title="' + esc(c.done ? c.text + ": done" : c.tool ? "Pick the " + c.text + " tool" : "Leave build mode when the house is planned") + '"><b>' + (c.done ? svg(I.done, 12) : n + 1) + "</b><span>" + esc(c.text) + "</span></button>").join("");
    }
  }
  // on a desktop the designer docks on the right down to the bar, and the hint row and tray keep to its left, so the
  // stage and the Size & place tab have the height they need
  let dockW = "";
  function designerDock() {
    const dock = !dpanel.hidden && dpanel.classList.contains("bdes") && !document.body.classList.contains("touch");
    bar.classList.toggle("bdock", dock);
    let w = "";
    if (dock) {
      const bm = $("bmain").getBoundingClientRect();
      dpanel.style.bottom = Math.round(window.innerHeight - bm.top + 8) + "px";
      w = Math.max(240, Math.round(dpanel.getBoundingClientRect().left - 12 - bar.getBoundingClientRect().left)) + "px";
    }
    if (w !== dockW) {
      dockW = w;
      for (const el of [opts, $("bhead")]) el.style.maxWidth = w;
    }
  }
  function frame() {
    if (!B.on) return void (sched.hidden || (sched.hidden = true), dpanel.hidden || (dpanel.hidden = true), flyClose(), (uiV = -1));
    if (uiV !== B.uiVer) {
      uiV = B.uiVer;
      const v = BL.view();
      renderOpts(v);
      text($("bhint"), v.hint);
      $("bhint").title = v.hint;
      renderBar(v);
      $("bstop").hidden = !v.busy;
      $("bstop").children[1].textContent = v.busy === "chain" ? "Finish" : v.busy === "copy" || v.busy === "move" ? "Put down" : "Stop";
      renderSched(v.sched, v);
      // how much of the view the bar covers: build mode frames the site in what is left above it. A steady figure (the
      // bar, a tray's height and the hint row, whatever the tool), so the view does not bob about between tools.
      // A door or window catalogue makes the tray taller than --tray-h: the tallest tray seen at this window size counts,
      // so the frame moves once and then holds. A hint row lifted out of the stack (a phone in landscape) does not
      // count. On a phone the inspector's sheet sits above the bar: its peek height counts (full does not; the frame
      // keeps the peek's).
      const k = window.innerWidth + "x" + window.innerHeight;
      if (barKey !== k) ((barKey = k), (trayMax = parseFloat(getComputedStyle(bar).getPropertyValue("--tray-h")) || 76), (peekH = 0));
      if (!opts.hidden) trayMax = Math.max(trayMax, opts.offsetHeight);
      const touch = document.body.classList.contains("touch"),
        sheet = touch && !dpanel.hidden && !(window.matchMedia && matchMedia("(orientation: landscape)").matches);
      if (!sheet) peekH = 0;
      else if (!dpanel.classList.contains("full")) peekH = dpanel.offsetHeight + 8;
      const hd = $("bhead"),
        headH = getComputedStyle(hd).position === "fixed" ? 0 : hd.offsetHeight;
      B.barH = Math.round(window.innerHeight - $("bmain").getBoundingClientRect().top + trayMax + headH + 12 + peekH);
      // the drawers end just above the bar (CSS anchors do it where they can; this is the fallback)
      const above = Math.round(window.innerHeight - bar.getBoundingClientRect().top + 8) + "px";
      for (const p of [dpanel, sched]) p.style.bottom !== above && (p.style.bottom = above);
      designerDock();
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
    // over a door or window's edge handle: the resize arrows
    let edge = B.ores ? (B.ores.k === "l" || B.ores.k === "r" ? "ew-resize" : "ns-resize") : "";
    if (!edge && B.ov.handles && B.ov.handles.length && B.ov.handles[0][4] && !B.ptr.touch)
      for (const d of handleEls) if (!d.hidden && Math.hypot(d._x - B.ptr.x, d._y - B.ptr.y) < 13) edge = d.className.includes("oh-ew") ? "ew-resize" : "ns-resize";
    const want = edge || (B.tool === "select" ? (B.move ? "grabbing" : B.hoverId ? "pointer" : "default") : B.tapMode ? "copy" : B.fover ? "grab" : "crosshair");
    if (want !== cursor) canvas.style.cursor = cursor = want;
  }
  B.frameHook = frame;
})();
