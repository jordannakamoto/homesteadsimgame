// The key map: one content table of every key and what it does in each context, the controls sheet drawn from it, and
// small key chips (<kbd class="kc">) for prompts. Content only: it listens to nothing (the engine opens the sheet on ? / F1).
// The table is read from the code, so when a key moves, move its row here. CLASHES holds the known ones, with who wins.
//
//   window.__keymap = {
//     contexts: [{ id, title, rows: [{ keys: ['W', 'A'], text, combat?, sandbox? }] }]   the table
//     rows(id) -> the rows for one context (combat rows only with localStorage.combat; sandbox rows only with localStorage.sandbox)
//     chip(key) -> '<kbd class="kc">E</kbd>'    key may be 'E', 'Shift', 'Esc', 'Space'...
//     chips('hold E') -> text with each upper-case key word in square brackets turned into chips: 'Hold [E] to ...' -> 'Hold <kbd>E</kbd> to ...'
//     render() -> fills #help from the table (call before showing it)
//     CLASHES
//   }
(() => {
  if (window.__keymap) return;
  const flag = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const R = (keys, text, o) => ({ keys: [].concat(keys), text, ...(o || {}) });

  const contexts = [
    { id: 'walking', title: 'Walking about', rows: [
      R('Mouse', 'Turn the camera (click the view first; Esc frees the mouse)'),
      R(['W', 'A', 'S', 'D'], 'Move'),
      R('Shift', 'Tap to roll, hold to sprint'),
      R('Space', 'Jump, and once more in the air'),
      R('Left click', 'Swing the axe: fells trees and breaks rocks. Hold for a heavier swing'),
      R('E', 'Hold at a work spot to do the job; tap to pick up or set down'),
      R('E', 'Parry a yellow attack just before it lands', { combat: true }),
      R('Q', 'Kick: opens a shield, stuffs a quick attack', { combat: true }),
      R('Hold right', 'Draw the bow and aim. Left click looses', { combat: true }),
      R('Alt + tap', 'Dash strike, or triple shot while aiming', { combat: true }),
    ] },
    { id: 'modes', title: 'What is in your hands', rows: [
      R('1', 'Axe'),
      R(['2', '3', '4'], 'Magic terrain brush: dig, raise, level (sandbox only)', { sandbox: true }),
      R('5', 'Garden: sow, water, hoe, harvest'),
      R('6', 'Yard: shovel, barrow, paths, stone, pond'),
      R('7', 'Site: lay out, dig, form and pour a foundation'),
      R('F', 'Hands: pump, fit pipes, plan cable and pipe, turn taps'),
      R('B', 'Build mode: draw plans'),
      R('L', 'Your buildings: order materials and raise them stage by stage'),
      R('Esc', 'Back to walking, from any of these'),
    ] },
    { id: 'tools', title: 'In Site, Yard, Garden and Hands', rows: [
      R(['1', '–', '9'], 'Pick the tool or item in the bar (or turn the wheel; in the Yard the wheel zooms)'),
      R('Click, drag', 'Use it where the marker is, inside your reach circle'),
      R('R', 'Turn what you hold (a part, a box, a stone); Shift+R turns back in the Yard'),
      R('C', 'Hands, holding a pipe or cable: cut it to fit. [ ] or the wheel set the length'),
      R('Right click', 'Hands: put the held part down'),
      R(['1', '2', '3', '4'], 'Hands, near a frame, nothing held: Power, Cold, Hot, Waste runs. R tries another route'),
      R('F', 'Garden: look closer at a plant'),
      R('N', 'Garden: the almanac'),
      R('Q E', 'Turn the view (Hands, where the camera is free); turn a part you are placing'),
      R('Wheel', 'Yard: zoom the view; Shift and the wheel tilt it. Middle drag turns and tilts it'),
      R('Click, hold', 'Yard, shovel: put the blade in; drag the load where it goes and let go'),
      R('Right click', 'Yard, shovel, left button held: a boot on the blade (deeper and wider); left button up: pat the ground down'),
      R('Right drag', 'Yard, shovel: push loose earth with the flat of the blade'),
    ] },
    { id: 'build', title: 'Build mode (B)', rows: [
      R(['V', '1'], 'Select'),
      R(['R', 'N', 'F', 'O'], 'Room, Wall, Floor, Roof (2 to 5). Press a tool’s key again to step through its styles'),
      R(['J', 'U', 'Z', 'P'], 'Door, Window, Stairs, Pillar (6 to 9); L Path (0); H Deck; C Furnish; Y Measure; X Remove'),
      R('E', 'Hold to turn the view; tap for Equip'),
      R(['PgUp', 'PgDn'], 'Level up and down ([ ] too); Shift for wall height'),
      R(['+', '−'], 'Lift'),
      R([',', '.'], 'Step through styles'),
      R('/', 'Snap'),
      R(['M', 'K', 'I'], 'Material, paint, pick (I picks up what is selected)'),
      R(['Ctrl+Z', 'Ctrl+Shift+Z'], 'Undo, redo. Ctrl+D duplicates, Ctrl+A selects the level'),
      R('Del', 'Remove the selection'),
      R('Enter', 'Finish a stroke or roof. Digits type an exact size while drawing'),
      R('Esc', 'Put down, then leave build mode'),
    ] },
    { id: 'panels', title: 'Panels and overlays', rows: [
      R('I', 'Inventory'),
      R('U', 'Supplier'),
      R('J', 'Notes and projects'),
      R('K', 'Kitchen'),
      R('H', 'Hens and the coop'),
      R('Y', 'Weather'),
      R('P', 'Utilities'),
      R('X', 'Overlays (power, water, heat): press to step through, anywhere'),
      R('G', 'Graphics quality'),
      R('`', 'Pause. ; slows time and ’ speeds it up'),
      R(['?', 'F1'], 'This sheet'),
    ] },
    { id: 'vehicle', title: 'On a vehicle', rows: [
      R('W', 'Throttle (hold to build speed)'),
      R('S', 'Brake; held once stopped, reverse'),
      R(['A', 'D'], 'Steer left and right, relative to the vehicle'),
      R('Space', 'Brake'),
      R('Shift', 'Gentle throttle'),
      R('E', 'Get off'),
      R('Hold R', 'Unhitch a trailer (stopped, with a trailer on)'),
      R('Hold left click', 'Tip the trailer bed'),
    ] },
    { id: 'kitchen', title: 'In the kitchen (K)', rows: [
      R('E', 'Eat from the plate'),
      R('H', 'Heat map'),
      R('Esc', 'Leave the kitchen'),
    ] },
  ];

  // keys more than one thing wants, and who wins (so a new binding can be checked against this list)
  const CLASHES = [
    { key: 'H', note: 'Deck in build mode (build has first refusal; the chickens view ignores keys there). Hens (chickens-view, capture) wins over the kitchen heat map while the kitchen is open only because the kitchen swallows keys first' },
    { key: 'X', note: 'overlays everywhere; build mode keeps X as Remove while it is open. Vehicle unhitch moved to hold R' },
    { key: 'U / Y / P / N / I / L', note: 'panels outside build mode; build tools inside it (build has first refusal)' },
    { key: '1-9', note: 'the bar slots inside Site, Yard, Garden and Hands; build tools in build mode; tool keys when walking' },
    { key: 'R', note: 'turns the held thing in Yard and Hands; unhitches (held) on a vehicle; room tool in build mode' },
    { key: 'F', note: 'Hands when walking; Garden look-closer inside Garden; Floor in build mode' },
    { key: '?', note: 'the sheet (F1 too); in build mode / is Snap' },
  ];

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const chip = (k) => '<kbd class="kc">' + esc(k) + '</kbd>';
  const chips = (t) => String(t).replace(/\[([^\]]+)\]/g, (m, k) => chip(k));
  const rows = (id) => {
    const c = contexts.find((x) => x.id === id);
    return c ? c.rows.filter((r) => (!r.combat || flag('combat')) && (!r.sandbox || flag('sandbox') === '1')) : [];
  };
  function render() {
    const el = document.getElementById('helpbody');
    if (!el) return;
    el.innerHTML = contexts.map((c) => {
      const rs = rows(c.id);
      return rs.length ? '<h2>' + esc(c.title) + '</h2><dl>' + rs.map((r) => '<dt>' + r.keys.map(chip).join(' ') + '</dt><dd>' + esc(r.text) + '</dd>').join('') + '</dl>' : '';
    }).join('');
  }
  window.__keymap = { contexts, rows, chip, chips, render, CLASHES };
  render();
})();
