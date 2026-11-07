# 💀 MEME WARS

**ONE MATCH. ONE WINNER. ONE VERY HUMILIATED FRIEND.**
Made with 💕 by AAHIL

A local multiplayer browser game for 2–4 friends on the same Wi-Fi or phone hotspot. One round, one random mini-game, and the winner controls a meme soundboard that plays on **everyone's** device.

> ⚠️ Opening `index.html` directly does **not** work. The game needs the Node.js server running.

---

## 1. Install Node.js (host only)

Only the person hosting needs this. Everyone else just uses a browser.

1. Go to <https://nodejs.org> and download the **LTS** version (Node 18 or newer).
2. Install it with the default options.
3. Check it worked. Open a terminal (Windows: Command Prompt or PowerShell) and run:
   ```
   node -v
   npm -v
   ```
   Both should print a version number.

## 2. Install the game's dependencies

Open a terminal **inside the `MEME-WARS` folder**, then run:

```
npm install
```

This downloads Express and Socket.IO. It needs internet **once**. After that the game works fully offline on your local network.

## 3. Start the server

```
npm start
```

You should see something like:

```
💀  MEME WARS server is running!
   On this computer:   http://localhost:3000
   Friends on Wi-Fi:   http://192.168.1.5:3000
```

Leave this window open while you play. Press `Ctrl+C` to stop.

If port 3000 is busy, use another one (`PORT=3001 npm start` on Mac/Linux, `set PORT=3001 && npm start` on Windows CMD).

## 4. Find the host's local IP address

The server prints it for you. The lobby also shows it with a copy button. To find it manually:

| System | How |
|---|---|
| Windows | `ipconfig` → look for **IPv4 Address** under your Wi-Fi adapter |
| macOS | `ipconfig getifaddr en0` (Wi-Fi) |
| Linux | `hostname -I` |
| Phone hotspot | Connect the host computer to the phone's hotspot first. Then use the address above. |

## 5. Connect the other players

1. Everyone joins the **same Wi-Fi network or hotspot** as the host.
2. On their phone or computer, they open the host's address in a browser, e.g. `http://192.168.1.5:3000`.
3. Tap **JOIN ROOM**, pick a name and avatar, and type the 4-character room code.

The host plays too. Open `http://localhost:3000` on the host computer, or use the network address.

## 6. Firewall (if friends can't connect)

- **Windows:** when Node first runs, Windows asks to allow it. Tick **Private networks** and click *Allow*. If you missed it: *Windows Security → Firewall → Allow an app → Node.js JavaScript Runtime → Private*.
- **macOS:** *System Settings → Network → Firewall* → allow incoming connections for `node`.
- **Linux (ufw):** `sudo ufw allow 3000/tcp`
- Some public, school or hotel Wi-Fi blocks devices from talking to each other ("client isolation"). Use a phone hotspot instead.

---

## 🔊 Audio files you still need to add

**No audio files are included.** I can't legally bundle meme clips, and I won't generate fake ones. Until a file is added, its button shows **"Audio file not added yet."** and is disabled. The server also refuses to play it.

Put each file in the folder below using the exact filename. Supported formats: `.mp3` (recommended), `.ogg`, `.wav`, `.m4a`. Restart is **not** needed, just reload the page.

### `public/assets/sounds/international/`

| Button | Filename |
|---|---|
| Bruh | `bruh.mp3` |
| Vine Boom | `vine-boom.mp3` |
| Metal Pipe | `metal-pipe.mp3` |
| Windows Error | `windows-error.mp3` |
| Cartoon Bonk | `cartoon-bonk.mp3` |
| Sad Trombone | `sad-trombone.mp3` |
| Dramatic Music | `dramatic-music.mp3` |
| Troll Laugh | `troll-laugh.mp3` |
| Airhorn | `airhorn.mp3` |
| Fail Sound | `fail-sound.mp3` |
| Victory Fanfare | `victory-fanfare.mp3` |

### `public/assets/sounds/custom/` (supplied by the project owner)

| Button label | Filename |
|---|---|
| Aayein Baigan Aayein? Baigan! | `aayein-baigan.mp3` |
| Elvish Yadav System Phadd Denge! | `elvish-system.mp3` |
| 10 Rupay Ki Pepsi Mera Bhai Sexy! | `10-rupay-pepsi.mp3` |
| Baburao Utha Le Re Baba! | `baburao-utha-le.mp3` |
| Nana Patekar Maut Ko Chuke Tak Se... | `nana-maut.mp3` |
| Nana Patekar Ekdum Jhakaas! | `nana-jhakaas.mp3` |
| O Bhai Maro Mujhe O Bhai! Maaro Mujhe, Maaro! | `o-bhai-maro.mp3` |
| Narendra Modi Meme | `modi-meme.mp3` |
| Aynenea Gatram Lavenena Bojhyam | `aynenea-gatram.mp3` |
| Rahul Gandhi — Aisa Machine Launga, Yahan Se Aloo Daloonga Aur Yahan Se Sona Niklega | `rahul-machine.mp3` |

**All 21 files are still needed.** The 10 custom clips are to be supplied by the project owner. Only add clips you have the right to use.

**Where to find legal international sounds:** [Freesound](https://freesound.org) (filter by *Creative Commons 0*), [Pixabay sound effects](https://pixabay.com/sound-effects/), [Wikimedia Commons](https://commons.wikimedia.org), or record your own. Check each license.

Keep clips short (under ~10 s) so they load fast on phones.

---

## How it works

- **Server (`server.js`)** is authoritative. It owns rooms, players, the match timeline, scores, the winner and soundboard permission.
- **Winner calculation:** highest score among players still connected. Ties are settled by a server-side coin flip (and the results screen says so). Players who disconnect mid-match are disqualified. If everyone else leaves, the last player wins by forfeit.
- **Mini-games**
  - *Reaction Rush:* the server sends "GO" and timestamps every tap itself. It subtracts the player's server-measured network round trip. Early taps cost 1000 ms each.
  - *Dodge Master:* every player gets the same seeded obstacle course. Survival time is clamped to the real elapsed time on the server.
  - *Aim Battle:* the server generates the target schedule. A hit only counts if the target exists, was not already hit by that player and the hit arrives inside the target's time window.
  - *Button Smash:* the server counts taps inside the 10-second window and caps the tap rate.
- **Sound deck:** the winner's browser sends `sound:play {id}`. The server checks (1) sender is in a room, (2) match is in results and sender is the verified winner, (3) the id is on the approved list, (4) the file exists, (5) cooldown has passed. It then broadcasts to that room only. Every browser plays its **own local copy** of the file. Nothing is streamed.
- **Reconnects:** each player gets a private token (kept in `sessionStorage`). If your connection drops or you refresh, you rejoin your seat within 45 seconds. If the host drops, the next connected player becomes host.
- **Settings and your name/avatar** are saved in `localStorage`.

## Project structure

```
MEME-WARS/
├── package.json
├── server.js
├── README.md
└── public/
    ├── index.html
    ├── style.css
    ├── game.js
    └── assets/
        ├── images/
        ├── avatars/            (avatars are emoji; folder reserved for your own art)
        └── sounds/
            ├── international/
            └── custom/
```

## Troubleshooting

| Problem | Fix |
|---|---|
| "Server unavailable" | The host's server isn't running, or you're on a different network. |
| Friends can't open the address | Check firewall (section 6) and that everyone is on the same Wi-Fi/hotspot. |
| "Room not found" | Check the 4-character code. Codes never contain `0`, `O`, `1` or `I`. |
| "Room is full" | Max 4 players per room. |
| No sound | Tap **ENABLE AUDIO** if the banner shows. Check phone volume and silent mode, and the in-game Mute. |
| Button says "Audio file not added yet." | Add the file with the exact name (see tables above), then reload. |
| Copy button doesn't copy | Plain `http://` addresses block the clipboard on some browsers. The game falls back to an older method. If that fails, select the text manually. |

---

## ✅ Testing report

**Honest status:** the code has been syntax-checked and the server logic has been run, but the full game has **not** yet been run in real browsers or on real phones. I had no network in the build environment, so `npm install` and a real Socket.IO session were not possible. Please run the checklist below on your own devices before calling it finished.

### What was actually run

The real `server.js` was run against an in-memory stand-in for Socket.IO/Express, driven by scripted bot players (all in one process). **All checks passed.**

| Check | Result |
|---|---|
| `node --check` on `server.js` and `game.js` | ✅ pass |
| Every `getElementById`-style lookup in `game.js` exists in `index.html`; every `data-action` has a handler | ✅ pass |
| Create room, join (case-insensitive code), wrong code, bad code, room full (5th player), non-host start blocked, start blocked with 1 player | ✅ pass |
| 3-player matches in all four mini-games (reaction, dodge, aim, smash), each ending with the correct server-chosen winner | ✅ pass |
| Cheat attempts: dodge time inflated (clamped), duplicate and bogus aim hits (rejected), smash burst (rate-capped), early reaction tap (penalised) | ✅ pass |
| Loser cannot play or stop sounds; unapproved sound id rejected; missing file reported; winner's sound reaches the other player; player outside the room gets nothing; cooldown enforced | ✅ pass |
| Rematch needs all players to agree; ready flags broadcast; host confirms | ✅ pass |
| Disconnect marks player offline; rejoin with token; bad token refused; host transfers when the host drops; new host can return to lobby | ✅ pass |

### Not yet tested (please run these)

- [ ] `npm install` and `npm start` on your machine
- [ ] Real browsers and a real Android phone (portrait layout, no horizontal scroll, touch controls)
- [ ] Two-player and four-player matches over real Wi-Fi
- [ ] Each mini-game visually and by touch (dodge canvas drag, aim canvas taps, smash button, reaction pad)
- [ ] Tie handling in a live match (the server logic exists, but no tie was forced)
- [ ] Sound playback on the other players' devices with **real audio files** (only a placeholder file was used)
- [ ] All 21 buttons once their files are added
- [ ] Audio-blocked banner, mute, volume sliders, stop button
- [ ] Browser refresh and Wi-Fi drop mid-lobby and mid-match
- [ ] Confetti, glitch animations and performance on a mid-range phone

### Known limitations

- Reaction timing is fair to within network jitter, not to the millisecond. Scores are decided by the server, and network delay is estimated and subtracted.
- Dodge Master and Aim Battle are mostly simulated in the browser (the server checks plausibility, not every frame). A determined cheater could still submit a believable-but-lucky time. For a local friends game this is a deliberate trade-off.
- A player can only join a room while it is in the lobby, not mid-match or on the results screen.
- Avatars are emoji. The `avatars/` and `images/` folders are empty and reserved.
