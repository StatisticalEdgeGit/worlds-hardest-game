/* VEX, the commentator. A level gets one or two chat lines, then only short
   tips ("Speed surge incoming."). From level 7, where lasers hide the safe
   lane, the route is called in a few words: "Far right, then inside, inside
   again." Hop the wrong way and VEX says so.

   Chat lines only mention things the current level actually has (a sweeper
   joke needs a sweeper). Nothing is said twice in one run: VEX remembers every
   chat line it has shown, game.js saves that memory with the run, and when the
   jokes run out VEX goes quiet rather than repeat itself. Tips are allowed to
   repeat; they're the same short call every time. */
(function (root) {
  'use strict';

  const G = root.WHG;

  /* ---------- pacing ---------- */

  const TYPE_CPS = 80;     // characters typed per second
  const INDICATOR = 0.3;   // seconds of "typing…" before the words start
  const READ_WPS = 3.3;    // words per second you can read while hopping

  /* Seconds a line stays up: the typing indicator, the typing, then reading time. */
  function readTime(text) {
    const words = text.split(/\s+/).length;
    return Math.min(9, Math.max(2.2, INDICATOR + text.length / TYPE_CPS + words / READ_WPS + 0.4));
  }

  /* ---------- lines ---------- */

  // A line is a string, or {t, tags, need, min}: tags = things the level must have,
  // need(v) = extra condition on the level and your stats, min = earliest tier.
  const L = (t, tags, need, min) => ({ t, tags: tags || null, need: need || null, min: min || 0 });

  /* General distractions, by how far in you are (levels 1–10, 11–40, 41–70, 71–100). */
  const SASS = [
    [
      'Hop when the lane runs out. That’s the whole game. I’ll wait.',
      'Keep your thumbs warm. They’re about to work.',
      'That hop was fine. I’m obliged to say one nice thing per level.',
      'Left, right, left. It’s not ballet. It’s worse.',
      'I’ll be here the whole time. I don’t get breaks.',
      'Watch the lanes, not me. Unless I’m being useful. I won’t say when.',
      'You blinked. I saw that.',
      'Enjoy this bit. It’s the easiest this game will ever be.',
      'I believe in you. Moderately. On a sliding scale.',
      'The dot has no brakes. It was never given brakes.',
      'Every lane ends. Some just end sooner.',
      'The dot trusts you completely. Bold of it.',
      'Nice rhythm. Don’t get attached to it.',
      'Holding your breath? Fine. Breathing is for later.',
      'A goldfish tested this game. It got further than most.',
      'You’re the main character. It’s a very short film.',
      'I’ve picked out a sympathetic font for when you die.',
      'Steady. Steadier. That’s it. Now panic slightly less.',
      'The neon is free. The lives are not.',
      'Some lanes look safe. That’s the trick they do.',
      'It’s a warm-up, in the sense that you’ll be sweating.',
      'I’m timing you. For nothing. I just enjoy it.',
      'Hop like nobody’s watching. I’m watching.',
      'Your thumbs are doing well. Your judgement, we’ll see.',
      'People ask if this game is fair. I say yes, then laugh for a while.',
      'Somewhere a speedrunner has already finished this level.',
      'The finish line is real. I’ve seen it. Twice.',
      'Every tap is recorded. Not for any reason. Just recorded.',
      L('If this feels hard, I have bad news about level {next}.', null, (v) => v.n < 100),
      L('You’re moving at the speed of a determined bicycle.', null, (v) => v.kmh < 45),
      'Don’t overthink it. Actually, do. Thinking helps.',
      'Imagine being a lane. You exist, and then you just… don’t.',
      'A lane ended behind you. Nobody held a service.',
      L('Three lives sounds like plenty. It isn’t.', null, (v) => v.mode === 'survival'),
      L('Unlimited lives. Unlimited counting. I’m counting.', null, (v) => v.mode === 'marathon'),
    ],
    [
      'I could make this easier. I’ve decided not to.',
      'Statistically, this is where people start blaming their phone.',
      'Is your thumb tired? Good. That means it’s working.',
      'I’m scoring your hops out of ten. You’re on a six. Generous.',
      'Tell a friend this game is easy. Then watch their face.',
      'Every lane here was placed to annoy you personally.',
      'Remember level 1? You thought that was hard. Sweet.',
      'If you’re reading this, your eyes aren’t on the track. Just noting it.',
      'One message this level will save you. This isn’t it.',
      'Do that again, but faster. And better. And now.',
      'Your reflexes are… present. Accounted for. Here.',
      'There’s a pause button. It won’t help, but it exists.',
      'You hop like someone who read the instructions. Twice. Slowly.',
      'Look at you, surviving. Almost impressive.',
      'Your dot is the pink one. In case you were wondering.',
      'The next bit is fine. The bit after that is not.',
      'You could quit now. Nobody would know. I would know.',
      'I don’t sleep. I just watch you hop. That’s not creepy, it’s my job.',
      'Hop count rising. Dignity holding steady. Just about.',
      'Quiet confidence. I like it. It won’t last.',
      'You’ve earned a compliment. Here it is: adequate.',
      'Some players cry around here. I keep a list. It’s long.',
      'If the lanes start looking friendly, that’s when they get you.',
      'That hop was clean enough that I nearly said something nice.',
      'Stay sharp. Or stay blunt and fall off. Your call.',
      'My favourite part of this level is coming up. You’ll hate it.',
      'Imagine doing this on a bus. Wait. Are you on a bus?',
      'I’ve seen better. I’ve seen much worse. You’re comfortably in between.',
      'You’re in the zone. The zone is very narrow.',
      'Every level is harder than the last. I’m saying it now so you can’t say I didn’t.',
      'The finish line is the only lane that never ends. Get to it.',
    ],
    [
      'Honestly, you don’t have to read this one. It’s a distraction. I’m checking whether you’re watching the map or me.',
      'This message is forty percent useful. You’ll have to work out which forty percent.',
      'Let me tell you about my weekend. I didn’t have one. I was building this level.',
      'Some of my tips save lives. This one is about my favourite number. It’s 7.',
      'Average human reaction time is about 250 milliseconds. Yours is… let’s not.',
      'I could warn you about what’s next. Instead, a sandwich: bread, cheese, more bread.',
      'Count the lanes. No, don’t. That’s how they get you.',
      'You’re reading again. The track is right there. Below this. Look.',
      'Keep reading. Keep hopping. Pick one. Actually, do both.',
      'The next message might matter. This one definitely doesn’t.',
      'Name five vegetables. Go. Also hop. Also don’t die.',
      'Do you ever think about how the dot feels? It’s terrified. Anyway.',
      'If you can read this whole sentence and still hop on time, you’re better than most, and most are not good.',
      'A riddle: what has lanes, a pink dot and you about to lose a life? This. It’s this.',
      'Look how far you’ve come. Don’t actually look. Watch the track.',
      'I’m writing a song about you. It’s mostly the sound of falling.',
      'There’s no fun fact here. You read it anyway.',
      'Your eyes just moved up here. I felt it.',
      'Breaking news: local dot still alive. More at eleven, probably less.',
      'Reading this costs you about half a second. Spend it wisely.',
      'Some messages are tips. Some are traps. This one is a sentence.',
      'I’d like to formally apologise for what happens in about four seconds.',
      'My therapist says I should be more supportive. Go you. There. Done.',
      'Somewhere there’s a version of you who stopped at level 1. They’re very relaxed.',
      'This is where most people look at me instead of the lanes. Are you most people?',
      'Every word you read here is a metre you didn’t watch.',
      'Listing the planets now. Mercury. Venus. Eyes on the track.',
      'I talk in capital letters on the inside. You should hear it in here.',
    ],
    [
      'Honestly, you don’t actually have to read this one. It’s more of a distraction, just making sure you’re paying attention to the map and not to what I say. Still reading? Interesting choice.',
      'Let me list every lane colour so far, in order. Cyan. Blue. Another blue. Teal. Okay, I can see you struggling, I’ll stop.',
      'I’m about to say something important. Not yet. Not yet. Okay, it wasn’t important.',
      'Imagine a lane. Now imagine it ending. Now look down, because that’s happening.',
      'This sentence is long enough to cost you a hop if you read it at your usual pace, which, judging by your last attempt, is leisurely.',
      'Some players read every message. Some players reach level 100. These groups barely overlap.',
      'There is exactly one useful sentence hidden in this level. It isn’t this one.',
      'Statistically you should be dead by now. I’m double-checking the maths.',
      'This is a distraction. So was that. Everything is a distraction except the lanes.',
      'Breathe in. Breathe out. Hop. Hop. Hop. Oh no.',
      'I’ll stop talking so you can concentrate. … … … No I won’t.',
      'A long word to read while hopping: antidisestablishmentarianism. You’re welcome.',
      'Terms and conditions, section one: you agree to lose. Section two: see section one.',
      'Please hold. Your concentration is important to us. Please continue to hold.',
      'Counting down from ten for no reason. Ten. Nine. Eight. Seven. I’ve lost interest.',
      'This is the part where the game stops pretending to be nice.',
      'The dot asked me to tell you it loves you. It didn’t. Hop.',
      'Remember when this was fun? Me neither. Keep going.',
      'Part of your brain is reading this. Another part is screaming. Listen to the screaming.',
      'Pi, from memory: 3.14159265358979. That’s enough pi. You dropped your focus.',
      'Would you like an extended warranty for your dot? It doesn’t cover falls.',
      'Nothing in this sentence will help you. Nothing in the next one will either. The one after that, possibly.',
      'Let me paint a picture. Neon. Darkness. A small pink dot about to make a big mistake.',
      'There’s no sound in this game. Just you, me, and whatever noise you just made.',
      'If you made it here without reading my messages, you’re not reading this. Hello to nobody.',
      'Everything is fine. The lanes are fine. The hazards are fine. You are… let’s see.',
    ],
  ];

  /* Lines about something this level actually has. */
  const TAGGED = [
    L('The red ones hurt. That’s the whole safety briefing.', ['laser']),
    L('Lasers don’t negotiate. I’ve tried.', ['laser']),
    L('That laser isn’t personal. I did programme it to be, though.', ['laser']),
    L('Quick: what colour was the last laser? Don’t look. Too late.', ['laser'], null, 2),
    L('Lanes are blue, lasers are red, you’ll hop for a while and then you’ll be dead.', ['laser'], null, 3),
    L('Every time you read one of my messages, a laser gets slightly brighter. That’s not true. Probably.', ['laser'], null, 3),
    L('Don’t look at the lasers. Don’t look at me. Look at the… actually, do look at the lasers.', ['laser'], null, 3),
    L('That laser blinked at you. It’s flirting. Don’t fall for it.', ['blink']),
    L('Blinking lasers keep a rhythm. You don’t have to like it. You have to read it.', ['blink']),
    L('Off, on, off, on. The dark lane is the only one that cares about you.', ['blink']),
    L('That spinning bar has a name. It’s Gary. Gary doesn’t like you.', ['sweeper']),
    L('Sweepers spin at the same speed every time. You could learn it. Just saying.', ['sweeper']),
    L('Somewhere, a sweeper is spinning just for you.', ['sweeper']),
    L('A sweeper, a laser and a dot walk into a bar. Two walk out.', ['sweeper', 'laser'], null, 2),
    L('The yellow block slides. You slide less. It’s an unequal relationship.', ['slider']),
    L('Sliders go left, then right. Like you, but on purpose.', ['slider']),
    L('The bends are scenery. Deadly scenery.', ['curve']),
    L('I added curves so you’d feel something.', ['curve']),
    L('Straight lines were too kind. So, bends.', ['curve']),
    L('When the track splits, I know which side lives. Keep reading me.', ['split']),
    L('Splits are where I earn my keep. Pay attention when they come.', ['split']),
    L('One side of every split ends. I’m the only one here who knows which.', ['split'], null, 1),
    L('I spin the view because I can. Left is still the dot’s left.', ['spin']),
    L('Mirror flips are my favourite. Your thumbs disagree.', ['mirror']),
    L('The lanes are breathing. Try not to take it personally.', ['drift']),
    L('Things drift around here. Including your concentration.', ['drift']),
    L('Speed surges come in bursts. Like my enthusiasm.', ['surge']),
    L('When I let go of the camera, the screen stops turning. The track doesn’t.', ['lock']),
    L('You can’t see over the hill. I can.', ['hills']),
    L('What’s over the next crest? I know. You’ll find out.', ['hills']),
    L('Hills: nature’s way of hiding a lane end from you.', ['hills']),
    L('Up, down, up. The road’s doing more work than you are.', ['hills']),
    L('The camera drops right down when it feels like it. Today it feels like it.', ['dive']),
    L('The view tips forward from here. Same lanes, worse angle.', ['tilt'], (v) => v.n <= 10),
  ];

  /* Lines about the level you're on. Different numbers on every level. */
  const LEVEL_FACTS = [
    L('Level {n}: {hazards} hazards, all placed with love. Mostly love.', null, (v) => v.hazards > 0),
    L('This level needs at least {hops} hops. You don’t get a vote.'),
    L('Top speed here: {kmh} km/h. No speed cameras. Lasers, though.', ['laser']),
    L('Top speed here: {kmh} km/h. Faster than you’d like.'),
    L('{lanes} lanes, and you can only be in one. Tragic, really.'),
    L('This track splits {splits} times. I’ll call each one. Keep reading.', null, (v) => v.splits >= 2),
    L('{worldName}, level {inWorld} of 10. Ten isn’t the easy one.'),
    L('Level {n}. {left} more after this. Don’t do the maths. Hop.', null, (v) => v.left > 0),
    L('About {secs} seconds long, if you don’t die. Let’s see what happens if you do.'),
    L('You’re doing {kmh} km/h. In a residential area.'),
  ];

  /* Lines that quote your own numbers back at you. */
  const STAT_LINES = [
    L('Attempt {attempt} at this level. The lanes haven’t moved. Have you?', null, (v) => v.attempt >= 2),
    L('You’ve lost {deaths} lives in total. I keep a spreadsheet.', null, (v) => v.deaths >= 2),
    L('Your average life lasts {avgLife}. Just so you know what you’re up against.', null, (v) => v.deaths >= 3),
    L('You’ve travelled {total} in this game. Mostly sideways.', null, (v) => v.totalM >= 300),
    L('Survival run number {runs}. Every single one started at level 1.', null, (v) => v.mode === 'survival' && v.runs >= 2),
    L('Level {n} has had you {levelDeaths} times. It’s starting to recognise you.', null, (v) => v.levelDeaths >= 2),
    L('Your survival record is level {highestPrev}. Not today, probably.', null, (v) => v.mode === 'survival' && v.highestPrev > v.n + 1),
    L('New territory. You’ve never got past level {highestPrev} in survival. Try not to get emotional.', null, (v) => v.mode === 'survival' && v.n > v.highestPrev && v.highestPrev > 1),
    L('{tries} tries at this level, all time. The level has tried zero times. It doesn’t need to.', null, (v) => v.tries >= 3),
    L('Lives left: {lives}. I’m not saying anything. I’m just saying the number.', null, (v) => v.mode === 'survival' && v.lives <= 2),
    L('You’ve pressed hop {hopsTotal} times. Your thumb would like a word.', null, (v) => v.hopsTotalN >= 150),
    L('This run: {runDist} so far. Your best is {bestRun}. No pressure.', null, (v) => v.bestRunM > 0 && v.runM > 0),
    L('Your toughest level is {nemesis}. This one’s auditioning for the job.', null, (v) => !!v.nemesisN && v.nemesisN !== v.n),
    L('You’ve fallen off {falls} lanes and hit {hits} hazards. Balanced, as all things should be.', null, (v) => v.falls + v.hits >= 4),
    L('Marathon life count: {used}. Lower is better. Just a reminder.', null, (v) => v.mode === 'marathon' && v.used >= 3),
    L('{used} lives into this marathon and you’re on level {n}. That’s {perLevel} lives a level.', null, (v) => v.mode === 'marathon' && v.used >= 5 && v.n > 2),
    L('Unlimited lives doesn’t mean free lives. I’m counting every one. {used} so far.', null, (v) => v.mode === 'marathon' && v.used >= 1),
    L('Your best marathon took {mBest} lives. This one’s at {used} and you’re only on level {n}.', null, (v) => v.mode === 'marathon' && v.mBest > 0 && v.used > 0),
    L('{used} lives across {done} levels cleared. I’d round that down, but I’m not allowed.', null, (v) => v.mode === 'marathon' && v.used >= 2 && v.n > 2),
  ];

  const WORLD_INTRO = [
    'Left and right hop you between lanes. Every lane ends eventually. When the track splits, I’ll tell you which way.',
    'The track bends now, and it rolls over hills. You won’t always see what’s over the top. I will.',
    'Lasers blink properly from here on. Be in the dark lane when you cross a row. Sometimes I’ll tell you which.',
    'More sweepers, more sliders. Timing matters now. So does reading.',
    'The lanes drift and squeeze together. Hold your nerve.',
    'I’ll be spinning the view. Left still means the dot’s left. I’ll warn you first.',
    'Mirrors flip the view. Your buttons don’t flip with it. I’ll tell you when.',
    'Faster. That’s it. That’s the message.',
    'The camera stops turning with you. The track goes every way. Keep your bearings.',
    'Everything at once. And I’ll be talking the whole time.',
  ];

  const LEVEL_START = [
    'Level {n}. Same rules, less mercy.',
    'Level {n}. You know what to do. Do it faster.',
    'Level {n}. I’ve made it worse. You’re welcome.',
    'Ah, level {n}. A classic. A classic way to lose a life.',
    'Level {n}. {hops} hops at least. I counted.',
    'Level {n}. Fresh lanes. Fresh mistakes.',
    'Welcome to level {n}. Please keep your dot inside the lanes at all times.',
    L('Level {n}. When it splits, read me.', ['split']),
    'Level {n}. I’d wish you luck, but I’ve seen your hops.',
    L('Level {n}. Like level {prev}, but meaner.', null, (v) => v.n > 1),
  ];
  const MARATHON_START = [
    'Marathon, level {n}. {used} lives used. Keep it low.',
    'Level {n} of the marathon. The counter says {used}. The counter never lies.',
    'Marathon check-in: level {n}, {used} lives. Carry on.',
  ];

  /* What VEX says after a death, by what killed you. */
  const DEATH = {
    edge: [
      'You hopped off the edge. There was nothing there. There’s never anything there.',
      'That was the edge. It isn’t a lane. It’s the edge.',
      'Off the side. Bold. Wrong, but bold.',
      'The outside lane is the last lane. There’s no secret one.',
    ],
    gap: [
      'That lane ended. It had a little line at the end and everything.',
      'The lane left. You stayed. That’s the problem.',
      'Gravity 1, you 0.',
      'You and that lane wanted different things.',
      'No lane, no dot. Simple maths.',
      'That gap was there the whole time. Just saying.',
    ],
    deadend: [
      'Wrong side of the split. That side ends.',
      'That was the dead end. Splits have one. Now you know where it is.',
      'Wrong path. The other side was right there.',
    ],
    told: [
      'I told you {side}. In words. On the screen.',
      'That was the side I said would end. It ended.',
      'I literally typed {side}. I watched you read it. Or not read it.',
      'The tip said {side}. The tip is always true. Remember that.',
    ],
    laser: [
      'That was a laser. They’re the red ones.',
      'You hopped into a laser. Lasers don’t move. You do.',
      'Laser 1, dot 0.',
    ],
    blink: [
      'That laser came on just as you got there. They do that.',
      'Wrong lane for that laser row. The dark one was free.',
      'It blinked on. You were in it. Timing.',
    ],
    sweeper: [
      'The spinning bar got you. Gary sends his regards.',
      'You and the sweeper met at exactly the wrong angle.',
      'Sweeper 1, dot 0. It didn’t even slow down.',
    ],
    slider: [
      'The yellow block was sliding. You were sliding less.',
      'That block slid into you. Technically you slid into it.',
      'Slider 1, dot 0.',
    ],
    any: [
      'Again. Faster this time.',
      'Same level, same lanes. Learn them.',
      'That’s one way to do it. The wrong way.',
      'Let’s pretend that didn’t happen. I won’t, but you can.',
      'Run it back.',
      'Shake it off. Then hop.',
      'Deep breath. Same lanes. Different you, hopefully.',
      'Well, that was educational.',
    ],
    last: [
      'Last life. No pressure. Actually, all of the pressure.',
      'One life left. I’ve started drafting your eulogy.',
      'Last life. Die now and it’s level 1 again. Just so you know.',
      'Final life. I’ll be quiet. No I won’t.',
      'One left. Make it count. Or don’t, and meet level 1 again.',
    ],
    stat: [
      L('Attempt {attempt}. Same lanes, same hazards, same you.', null, (v) => v.attempt >= 2),
      L('That’s {deaths} lives gone, all time. Level {n} alone has taken {levelDeaths}.', null, (v) => v.levelDeaths >= 2),
      L('That life lasted {lastLife}. Your average is {avgLife}. Make of that what you will.', null, (v) => v.deaths >= 2 && v.lastLifeM > 0),
      L('Death number {deaths}. I’m running out of ways to be surprised.', null, (v) => v.deaths >= 5),
      L('Life {used} gone. The counter goes up. It never goes down.', null, (v) => v.mode === 'marathon' && v.used >= 1),
      L('Marathon score now {used}. Remember, lower is better.', null, (v) => v.mode === 'marathon' && v.used >= 2),
    ],
  };

  const CLEAR = [
    'Fine. That one counts.',
    'Level {n} done. {left} to go.',
    'Lucky.',
    'Okay, that was decent. Don’t let it go to your head.',
    'You survived. The bar was low, but you cleared it.',
    'Huh. Didn’t expect that.',
    'Level {n}, cleared. I’ll allow it.',
    'Through. Barely. Mostly. Through.',
    'That counts. I checked.',
    'Next one. Quickly, before you get comfortable.',
    'Not bad. Not good either. Not bad.',
    'Cleared. The dot is relieved. I’m neutral.',
  ];

  const OVER = [
    'Back to level 1. I’ll be here. I’m always here.',
    'Three lives, gone. Level 1 missed you.',
    'That’s the game. Well, that’s your game.',
    'I’d say better luck next time, but luck isn’t the problem.',
  ];
  const OVER_STAT = [
    'That run covered {runDist}. Your best is {bestRun}. Level 1 is waiting.',
    '{deaths} lives lost, all time. Your average life: {avgLife}. Back to the start.',
  ];

  const PAUSE = [
    'Pausing won’t make it easier.',
    'Take your time. The lanes will wait. I won’t enjoy it.',
    'Stretch your thumbs. You’ll need them.',
    'Paused. The hazards are still thinking about you.',
  ];

  const TITLE = 'The small green lines are tips. They’re true. I’ll only chatter once or twice.';
  const TITLE_BACK = [
    'Welcome back. {deaths} lives lost so far and {total} travelled. Let’s add to both.',
    'Oh, it’s you. Your survival best is level {highestPrev}. I remember. I remember everything.',
    'Back again? Survival for glory, marathon for punishment. Your pick.',
  ];
  const WIN = {
    survival: 'You actually did it. I need a moment. I don’t have moments, but I need one.',
    marathon: 'All 100 levels. I counted every life it took. Every single one.',
  };
  const DRY = 'I’ve said everything I have to say this run. I’ll just watch now. Tips still come, though.';

  /* ---------- short tips. The same words every time, on purpose. ---------- */

  /* How each tip reads when two of them have to share one bubble. */
  const CLAUSE = {
    fork: (e) => `go ${e.side}`,
    spin: () => 'spin incoming',
    flip: () => 'mirror incoming',
    lock: () => 'camera lock incoming',
    dive: () => 'low camera incoming',
    surge: () => 'speed surge incoming',
    route: (e) => {
      const t = e.text.replace(/\.$/, '');
      return t.charAt(0).toLowerCase() + t.slice(1);
    },
  };

  /* ---------- helpers ---------- */

  function rngFrom(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : ''));
  const upper = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const tierOf = (n) => (n <= 10 ? 0 : n <= 40 ? 1 : n <= 70 ? 2 : 3);

  function fmtDist(m) {
    m = Math.max(0, m || 0);
    return m < 10000 ? `${Math.round(m).toLocaleString('en-GB')} m` : `${(m / 1000).toFixed(1)} km`;
  }

  /* What this level has, so lines only mention real things. */
  function featuresOf(lv) {
    const f = { laser: false, blink: false, sweeper: false, slider: false };
    for (const h of lv.hazards) {
      if (h.type === 'laser') { f.laser = true; if (h.period) f.blink = true; }
      else f[h.type] = true;
    }
    f.split = lv.forks.length > 0;
    f.spin = lv.cam.spins.length > 0;
    f.mirror = lv.cam.flips.length > 0;
    f.lock = lv.cam.locks.length > 0;
    f.drift = !!lv.drift;
    f.surge = lv.speedProfile.surges.length > 0;
    f.curve = lv.world >= 1 || lv.n >= 4;
    f.hills = !!(lv.view && lv.view.hills);
    f.tilt = !!(lv.view && lv.view.tilt > 0);
    f.dive = !!(lv.cam.dives && lv.cam.dives.length);
    return f;
  }

  /* ---------- memory: what VEX has already said this run ---------- */

  const said = new Set();
  function hash(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }
  const wasSaid = (text) => said.has(hash(text));
  function markSaid(text) {
    if (text && said.size < 6000) said.add(hash(text));
  }
  function resetMemory(list) {
    said.clear();
    if (Array.isArray(list)) for (const h of list) said.add(String(h));
  }
  const memory = () => Array.from(said);

  function usable(item, v) {
    if (typeof item === 'string') return true;
    if (item.min > v.tier) return false;
    if (item.tags && !item.tags.every((tag) => v.f && v.f[tag])) return false;
    return !item.need || item.need(v);
  }

  /* A line from the pool that fits this level and nobody has heard this run. */
  function freshFrom(rnd, pool, vars, taken) {
    const order = pool.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    for (const i of order) {
      const item = pool[i];
      if (!usable(item, vars)) continue;
      const text = fill(typeof item === 'string' ? item : item.t, vars);
      if (!taken(text)) return text;
    }
    return null;
  }

  function statVars(c) {
    return Object.assign({ tier: 0, f: {} }, c, {
      total: fmtDist(c.totalM), avgLife: fmtDist(c.avgLifeM), runDist: fmtDist(c.runM), bestRun: fmtDist(c.bestRunM),
      lastLife: fmtDist(c.lastLifeM), hopsTotal: (c.hopsTotal || 0).toLocaleString('en-GB'), hopsTotalN: c.hopsTotal || 0,
      nemesis: c.nemesisN ? `level ${c.nemesisN}` : '',
      perLevel: c.n > 1 ? (c.used / (c.n - 1)).toFixed(1) : '0', done: Math.max(0, c.n - 1), prev: c.n - 1, next: c.n + 1,
    });
  }

  function levelVars(lv, c) {
    let top = 0;
    for (let s = 0; s < lv.length; s += 200) top = Math.max(top, G.speedAt(lv, s));
    return Object.assign(statVars(c), {
      n: lv.n, hazards: lv.hazards.length, hops: lv.hopTarget, lanes: lv.lanes, splits: lv.forks.length,
      kmh: Math.round(top * 0.18), secs: Math.round(lv.seconds), worldName: lv.name,
      inWorld: ((lv.n - 1) % 10) + 1, left: G.LEVEL_COUNT - lv.n, prev: lv.n - 1, next: lv.n + 1,
      tier: tierOf(lv.n), f: featuresOf(lv),
    });
  }

  const reversedNote = (e) => (e.reversed && e.type === 'fork' ? ` Your ${e.side}.` : '');

  /* One short line per event. These repeat on purpose, so they skip the "already said" memory. */
  function tipFor(e) {
    const note = reversedNote(e);
    let text = null, lead = 1.4, pri = 2;
    switch (e.type) {
      case 'fork':
        text = `Go ${e.side}.`;
        lead = 2.0; pri = 3;
        break;
      case 'spin': text = 'Spin incoming.'; break;
      case 'flip': text = 'Mirror incoming.'; break;
      case 'dive': text = 'Low camera incoming.'; break;
      case 'lock': text = 'Camera lock incoming.'; lead = 1.6; break;
      case 'surge': text = 'Speed surge incoming.'; lead = 1.2; pri = 1; break;
      default: return null;
    }
    return { text: text + note, lead, pri, ev: e };
  }

  /* Where one hop through the lasers should end up, in the dot's own left and right. */
  function moveWord(from, to, lanes) {
    if (to <= 0) return 'far left';
    if (to >= lanes - 1) return 'far right';
    const mid = (lanes - 1) / 2;
    const d0 = Math.abs(from - mid), d1 = Math.abs(to - mid);
    if (d1 < d0 - 0.01) return Math.abs(to - from) > 1 && d1 < 0.01 ? 'middle' : 'inside';
    if (d1 > d0 + 0.01) return 'outside';
    return to < from ? 'left' : 'right';
  }

  /* "far right" + "inside" + "inside" → "Far right, then inside, inside again." */
  function routePhrase(words) {
    const bits = [];
    let run = 0;
    for (let i = 0; i < words.length; i++) {
      if (i > 0 && words[i] === words[i - 1]) {
        run++;
        bits.push(run >= 2 ? 'and again' : `${words[i]} again`);
      } else {
        run = 0;
        bits.push(words[i]);
      }
    }
    let s = bits[0];
    for (let i = 1; i < bits.length; i++) s += (i === 1 ? ', then ' : ', ') + bits[i];
    return s.charAt(0).toUpperCase() + s.slice(1) + '.';
  }

  /* From level 7 the safe lane through a laser is called before you can see it.
     Consecutive laser hops share one line, up to four moves. */
  function routeCues(lv) {
    if (lv.n < 7 || !lv.route || !lv.route.length) return [];
    const steps = lv.route.map((e, i) => {
      const next = lv.route[i + 1];
      const zone1 = next ? next.h0 : lv.length;
      let laser = false;
      for (const h of lv.hazards) {
        if (h.type === 'laser' && h.s >= e.h1 - 4 && h.s < zone1) laser = true;
      }
      return { from: e.from, to: e.to, h0: e.h0, h1: e.h1, zone1, laser };
    });
    const cues = [];
    let i = 0;
    while (i < steps.length) {
      if (!steps[i].laser || steps[i].from === steps[i].to) { i++; continue; }
      const group = [steps[i]];
      let j = i + 1;
      while (j < steps.length && group.length < 4) {
        const cur = steps[j];
        if (!cur.laser) break;
        const prev = group[group.length - 1];
        if (G.timeAt(lv, cur.h0) - G.timeAt(lv, prev.zone1) > 4) break;
        if (cur.from !== cur.to) group.push(cur);
        j++;
      }
      const words = group.map((g) => moveWord(g.from, g.to, lv.lanes));
      const h0 = group[0].h0;
      cues.push({
        id: cues.length,
        s: h0,
        lead: G.speedAt(lv, h0) * 0.9,
        text: routePhrase(words),
        steps: group.map((g, k) => ({ from: g.from, to: g.to, word: words[k], h0: g.h0, h1: g.h1, sEnd: g.zone1 })),
      });
      i = j;
    }
    return cues;
  }

  /* The lane a hop is committed to, including taps still waiting in the queue. */
  function committedLane(p) {
    return p.hop >= 0 ? p.lane + p.queued : p.lane;
  }

  /* Wrong hop during a called laser move: {word, id}, or null if this lane is still on the way. */
  function routeWrong(lv, p, laneNow) {
    if (!lv.cues) return null;
    let early = null;
    for (const cue of lv.cues) {
      for (let k = 0; k < cue.steps.length; k++) {
        const st = cue.steps[k];
        if (p.s >= st.sEnd) continue;
        const started = p.s >= st.h0;
        const inLead = k === 0 && p.s >= st.h0 - cue.lead;
        if (!started && !inLead) continue;
        const lo = Math.min(st.from, st.to), hi = Math.max(st.from, st.to);
        const miss = laneNow < lo || laneNow > hi ? { word: st.word, id: cue.id } : null;
        if (started) return miss;
        early = miss;
      }
    }
    return early;
  }

  /* Word of the laser call the player missed: wrong lane, or a laser hit off the one they were told. */
  function ignoredWord(lv, p) {
    if (!lv.cues) return '';
    let word = '';
    for (const cue of lv.cues) {
      for (const st of cue.steps) {
        if (p.s < st.h0 || p.s > st.sEnd + 30 || p.lane === st.to) continue;
        const lo = Math.min(st.from, st.to), hi = Math.max(st.from, st.to);
        const off = p.lane < lo || p.lane > hi;
        if (off || p.why === 'laser' || p.why === 'blink') word = st.word;
      }
    }
    return word;
  }

  /* Two warnings that land together: "Go left. Then speed surge incoming." */
  function mergeTips(a, b, lv) {
    if (!CLAUSE[a.ev.type] || !CLAUSE[b.ev.type]) return null;
    const first = CLAUSE[a.ev.type](a.ev, lv), second = CLAUSE[b.ev.type](b.ev, lv);
    const note = reversedNote(a.ev) || reversedNote(b.ev);
    return `${upper(first)}. Then ${second}.${note}`;
  }

  /* ---------- the schedule for one attempt at a level ---------- */

  /* Returns [{t0, t1, text, side, fork}], times in seconds of run time. Chat lines
     haven't been said this run. Tips are short and may repeat. game.js marks each
     line as said when it actually shows (dying early leaves later lines unused).
     Lines start no earlier than `from`; `reserved` lines are being said elsewhere. */
  function plan(lv, attempt, ctx, from, reserved) {
    const rnd = rngFrom(lv.n * 7919 + attempt * 104729 + said.size * 31 + 17);
    const tier = tierOf(lv.n);
    const end = G.timeAt(lv, lv.length);
    const sideOf = () => (tier >= 2 && rnd() < 0.45 ? 'right' : 'left');
    const planned = new Set(reserved || []);
    const taken = (t) => planned.has(t) || wasSaid(t);
    const keep = (t) => { planned.add(t); return t; };

    const cues = routeCues(lv);
    lv.cues = cues;

    const wanted = [];
    const warned = new Set();   // spins, camera locks and surges get one warning per level
    for (const e of lv.events) {
      if (e.s >= lv.length || e.type === 'blink') continue;
      if ((e.type === 'spin' || e.type === 'lock' || e.type === 'surge') && warned.has(e.type)) continue;
      const tip = tipFor(e);
      if (!tip) continue;
      warned.add(e.type);
      const t1 = e.t - 0.1;
      wanted.push({ t0: Math.max(-0.4, t1 - Math.max(tip.lead, readTime(tip.text))), t1, text: tip.text, pri: tip.pri, ev: e });
    }
    for (const cue of cues) {
      const tHop = G.timeAt(lv, cue.s);
      const dur = Math.min(3.3, Math.max(readTime(cue.text), 1.7));
      const t1 = tHop + 0.2;
      const ev = { type: 'route', text: cue.text, s: cue.s, t: tHop };
      wanted.push({ t0: Math.max(-0.4, t1 - dur), t1, text: cue.text, pri: 3, ev });
    }
    wanted.sort((a, b) => a.t0 - b.t0);

    // Tips that collide get shortened. If they still collide, two important ones
    // merge into one sentence; otherwise the more important one wins.
    const tips = [];
    for (const it of wanted) {
      const prev = tips[tips.length - 1];
      if (prev && it.t0 < prev.t1 + 0.2) {
        const minEnd = prev.t0 + Math.min(readTime(prev.text), 2.2);
        // Two spins (or two surges) are the same warning. Two route calls are not.
        if (prev.ev.type === it.ev.type && prev.ev.type !== 'fork' && prev.ev.type !== 'route') {
          prev.t1 = Math.max(prev.t1, it.t1);
          continue;
        } else if (minEnd <= it.t0 - 0.12) {
          prev.t1 = it.t0 - 0.12;
        } else if (prev.ev.type === 'route' && it.ev.type === 'route') {
          // Separate laser calls stay separate. Cut the earlier one off so the next can be read.
          prev.t1 = it.t0 - 0.08;
          if (prev.t1 < prev.t0 + 0.7) tips.pop();
        } else if (it.pri >= 2 && prev.pri >= 2 && !prev.merged) {
          const text = mergeTips(prev, it, lv);
          if (text) {
            const earlier = tips.length >= 2 ? tips[tips.length - 2].t1 + 0.1 : -0.4;
            prev.text = text;
            prev.t1 = Math.max(prev.t1, it.t1);
            prev.t0 = Math.max(earlier, Math.min(prev.t0, prev.t1 - readTime(text)));
            prev.merged = true;
            if (it.ev.type === 'fork') prev.fork = it.ev.fork;
          }
          continue;
        } else if (it.pri > prev.pri) {
          tips.pop();
        } else {
          continue;
        }
      }
      tips.push({ t0: it.t0, t1: it.t1, text: it.text, pri: it.pri, ev: it.ev, side: 'left', fork: it.ev.type === 'fork' ? it.ev.fork : -1 });
    }

    // One or two chat lines per level. Everything else is a tip.
    const GAP = [[5, 8], [4, 7], [3, 6], [2.2, 4.5]][tier];
    const chatterCap = rnd() < 0.4 ? 2 : 1;
    const vars = levelVars(lv, ctx || { n: lv.n });
    let dry = false, facts = 0, statsSaid = 0;
    function sassLine(maxTime) {
      const bad = (t) => taken(t) || readTime(t) > maxTime;
      const r = rnd();
      let text = null;
      // At most one line about the level and two about your stats per attempt, so neither drones on.
      if (ctx && r < 0.14 && facts < 1) { text = freshFrom(rnd, LEVEL_FACTS, vars, bad); if (text) facts++; }
      else if (ctx && r < 0.32 && statsSaid < 2) { text = freshFrom(rnd, STAT_LINES, vars, bad); if (text) statsSaid++; }
      else if (r < 0.55) text = freshFrom(rnd, TAGGED, vars, bad);
      if (!text) text = freshFrom(rnd, SASS[rnd() < 0.7 ? tier : Math.floor(rnd() * (tier + 1))], vars, bad);
      // That pool is used up: try everything else before going quiet.
      for (let k = tier; k >= 0 && !text; k--) text = freshFrom(rnd, SASS[k], vars, bad);
      if (!text) text = freshFrom(rnd, TAGGED, vars, bad);
      if (!text && ctx) text = freshFrom(rnd, LEVEL_FACTS.concat(STAT_LINES), vars, bad);
      if (!text && !dry && !bad(DRY)) { dry = true; text = DRY; }
      return text ? keep(text) : null;
    }
    // Quiet stretches between tips, long enough for one line and a beat of clear road.
    const spans = [];
    let cursor = from == null ? 0.6 : from;
    for (const tip of tips) {
      if (tip.t0 - 0.7 > cursor + 2.4) spans.push([cursor, tip.t0 - 0.7]);
      cursor = Math.max(cursor, tip.t1 + 0.35);
    }
    if (end - 0.4 > cursor + 2.4) spans.push([cursor, end - 0.4]);
    const out = [];
    let chatter = 0;
    for (const [a, b] of spans) {
      let t = a;
      while (chatter < chatterCap && t + 2.4 < b) {
        const start = t + 0.3 + rnd() * Math.min(GAP[1], Math.max(0.2, (b - t) * 0.4));
        if (start + 2.2 > b) break;
        const line = sassLine(b - start);
        if (!line) break;
        const dur = Math.min(readTime(line), b - start);
        out.push({ t0: start, t1: start + dur, text: line, side: sideOf(), fork: -1, tip: false });
        chatter++;
        t = start + dur + GAP[0];
      }
    }
    return out.concat(tips.map((x) => ({ t0: x.t0, t1: x.t1, text: x.text, side: x.side, fork: x.fork, tip: true })))
      .sort((a, b) => a.t0 - b.t0);
  }

  /* ---------- one-off lines (each returns null when VEX has nothing new) ---------- */

  /* What VEX says as a level starts. After a death ctx has retry, why (what killed
     you), told (VEX had told you the way at that split) and side. */
  function intro(lv, attempt, ctx) {
    const rnd = rngFrom(lv.n * 31 + attempt * 977 + said.size);
    const vars = levelVars(lv, ctx);
    if (ctx.retry) {
      vars.side = ctx.side || '';
      if (ctx.ignored) return `What do you think ${ctx.ignored} means? Muppet.`;
      const pick = (pool) => freshFrom(rnd, pool, vars, wasSaid);
      // Most specific first: ignoring a tip, last life, then what actually killed you.
      if (ctx.why === 'deadend' && ctx.told) { const t = pick(DEATH.told); if (t) return t; }
      if (ctx.mode === 'survival' && ctx.lives === 1) { const t = pick(DEATH.last); if (t) return t; }
      if (rnd() < 0.2) { const t = pick(DEATH.stat); if (t) return t; }
      return pick(DEATH[ctx.why] || []) || pick(DEATH.any) || pick(DEATH.stat);
    }
    const last = 'Level 100. The last one. I saved my worst for this.';
    if (lv.n === G.LEVEL_COUNT && !wasSaid(last)) return last;
    if ((lv.n - 1) % 10 === 0 && !wasSaid(WORLD_INTRO[lv.world])) return WORLD_INTRO[lv.world];
    const r = rnd();
    if (ctx.mode === 'marathon' && r < 0.35) {
      const t = freshFrom(rnd, MARATHON_START, vars, wasSaid);
      if (t) return t;
    }
    if (r < 0.6) {
      const t = freshFrom(rnd, STAT_LINES.concat(LEVEL_FACTS), vars, wasSaid);
      if (t) return t;
    }
    return freshFrom(rnd, LEVEL_START, vars, wasSaid) || freshFrom(rnd, LEVEL_FACTS, vars, wasSaid);
  }

  function clear(n) {
    return freshFrom(Math.random, CLEAR, { n, left: G.LEVEL_COUNT - n, tier: 0, f: {} }, wasSaid);
  }

  function over(ctx) {
    const vars = statVars(ctx);
    if (ctx.deaths >= 3 && Math.random() < 0.5) {
      const t = freshFrom(Math.random, OVER_STAT, vars, wasSaid);
      if (t) return t;
    }
    return freshFrom(Math.random, OVER, vars, wasSaid) || OVER[0];
  }

  function title(ctx) {
    if (!ctx || (!ctx.runs && !ctx.mRuns)) return TITLE;
    return fill(TITLE_BACK[Math.floor(Math.random() * TITLE_BACK.length)], statVars(ctx));
  }

  const pause = () => PAUSE[Math.floor(Math.random() * PAUSE.length)];

  /* Races: heckling about the other racers. {name} is a rival, {target} the last level. */
  const RACE = {
    start: [
      'First to clear level {target} wins. Everyone else gets my opinion.',
      'Race on. Same levels, same lasers. Only the excuses differ.',
      'Clear level {target} before the others do. Simple. Not easy.',
    ],
    passed: [
      '{name} just went past you.',
      '{name} is ahead now. Do something about it.',
      'That was {name} overtaking you. In case you missed it.',
      '{name} passed you. Rude, but legal.',
    ],
    passing: [
      'You passed {name}. Don’t look back. Look forward.',
      'Ahead of {name}. For now.',
      '{name} is behind you. Keep it that way.',
    ],
    rivalDied: [
      '{name} just died. Don’t celebrate. You’re next.',
      '{name} hit something. Checkpoint time for them.',
      'One fewer {name} on the track. Briefly.',
    ],
    left: ['{name} left the race. Couldn’t take it.', '{name} quit. Fewer witnesses.'],
    dropped: ['{name} lost their connection. Or their nerve.', '{name} dropped out. Phone, probably. Possibly willpower.'],
    back: ['{name} is back. The race didn’t wait.', '{name} reconnected. Nobody missed them.'],
    won: ['You won. Against actual people. I’m almost impressed.', 'First. Enjoy it. Nobody will remember.'],
    lost: ['{name} won. I’d say well done, but it wasn’t you.', '{name} got there first. You got there eventually. Or didn’t.'],
  };
  function race(kind, vars) {
    const pool = RACE[kind];
    return pool ? freshFrom(Math.random, pool, Object.assign({ tier: 0, f: {} }, vars), wasSaid) : null;
  }

  /* World intros explain a new mechanic, so they're shown as tips. */
  const isTipText = (text) => WORLD_INTRO.includes(text);

  root.VEX = {
    plan, intro, clear, over, title, pause, race, readTime, fmtDist, isTipText, WIN, TYPE_CPS, INDICATOR,
    routeWrong, ignoredWord, committedLane,
    markSaid, wasSaid, resetMemory, memory,
  };
})(window);
