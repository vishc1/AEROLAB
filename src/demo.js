/**
 * One-click guided tour for the video: cylinder -> airfoil test -> vorticity
 * -> 3D wing -> car. Every step shows a caption; Esc or the button stops it.
 */
export function createDemo({ store, actions, caption }) {
  let token = 0;
  const box = document.getElementById('demo-caption');
  const stepEl = document.getElementById('demo-step');
  const textEl = document.getElementById('demo-text');
  const button = document.getElementById('demo-start');

  const sleep = (ms, id) =>
    new Promise((resolve) => setTimeout(() => resolve(id === token), ms));

  const say = (n, total, text) => {
    box.hidden = false;
    stepEl.textContent = `${n}/${total}`;
    textEl.textContent = text;
  };

  const stop = () => {
    token += 1;
    box.hidden = true;
    button.textContent = '▶ Auto demo';
    actions.setAutoName(null);
  };

  async function start() {
    if (button.dataset.running === '1') {
      button.dataset.running = '0';
      return stop();
    }
    const id = (token += 1);
    button.dataset.running = '1';
    button.textContent = '■ Stop demo';
    const N = 6;
    const alive = async (ms) => (await sleep(ms, id)) && button.dataset.running === '1';
    try {
      store.patch({ vorticity: false, running: true, windSpeed: 18 });
      if (store.state.dim !== '2d') actions.setDim('2d');
      await actions.setInput('draw');

      actions.selectPreset('cylinder');
      say(1, N, 'Air flows past a cylinder. Those swirls are the Kármán vortex street, solved live.');
      if (!(await alive(7000))) return;

      actions.selectPreset('airfoil');
      say(2, N, 'Swap in an airfoil. The flow stays attached and the wake gets thin.');
      if (!(await alive(5000))) return;

      say(3, N, 'Run a 5-second test to score it. No equations to write.');
      actions.setAutoName('Demo airfoil');
      actions.runBenchmark();
      if (!(await alive(7500))) return;

      say(4, N, 'Turn on vorticity: red and blue show which way the air spins.');
      store.patch({ vorticity: true });
      actions.syncUI();
      if (!(await alive(6000))) return;
      store.patch({ vorticity: false });

      say(5, N, 'Now in 3D: sketch a side profile and a top view, and a wing appears.');
      actions.setDim('3d');
      actions.setBuild('sketch');
      store.patch({ vorticity: true });
      actions.syncUI();
      if (!(await alive(9000))) return;

      store.patch({ vorticity: false });
      actions.setDim('2d');
      actions.selectPreset('car');
      say(6, N, 'Or test a car. Compare drag, pin a baseline, share your score on the board.');
      await alive(7000);
    } finally {
      if (token === id) {
        stop();
        button.dataset.running = '0';
      }
    }
  }

  button.addEventListener('click', start);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && button.dataset.running === '1') {
      button.dataset.running = '0';
      stop();
    }
  });
  if (new URLSearchParams(location.search).get('demo') === '1') setTimeout(start, 900);
  return { start, stop };
}
