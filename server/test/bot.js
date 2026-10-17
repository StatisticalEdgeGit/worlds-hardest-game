'use strict';

/* Plays a level with the same bot the level checker uses, recording every hop the
   way the game does: [tick, direction], logged on the tick the hop is applied. */
function botRun(G, lv, f = () => 0.35, intro = 1.6) {
  const p = G.newRunner(lv, intro);
  const triggers = G.botTriggers(lv, f);
  const inputs = [];
  while (!p.dead && !p.won && p.tick < 1e6) {
    const before = p.hop;
    G.botStep(lv, p, triggers);
    if (before < 0 && p.hop === 0) inputs.push([p.tick, Math.sign(p.lane - p.from)]);
    G.stepRunner(lv, p);
  }
  return { inputs, endTick: p.tick, lane0: lv.startLane, won: p.won };
}

module.exports = { botRun };
