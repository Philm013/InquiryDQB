# Hosting InquiryDQB yourself

InquiryDQB is a static site, so "hosting" means two small things: somewhere to serve the files, and (optionally) your own PeerServer, the tiny service that introduces a student's browser to the teacher's.

## 1. Serve the files

Any static host works: GitHub Pages, Netlify, an S3 bucket, a school web server, or `npm start` on a laptop. Serve over **https** (or `http://localhost`): browsers only allow the camera (QR scanning), service workers and installation on secure origins.

Nothing needs configuring. The site makes no requests to other hosts except to the PeerServer.

## 2. Run your own PeerServer (optional)

By default the apps use the free public PeerJS service. Run your own if your network blocks it, or you want connection details to stay inside your organisation.

```bash
npm install -g peer
peerjs --port 9000 --path /
```

Put it behind https (a reverse proxy such as Caddy or nginx with a certificate), for example at `peer.example.org` on port 443.

### Point the apps at it

Open the teacher console once with the server in the address:

```
https://your-site.example/Teacher/?peerHost=peer.example.org&peerPort=443&peerPath=/&peerSecure=1
```

The setting is remembered in that browser, and the join link and QR code the teacher shares include it, so students pick it up automatically. To go back to the public service, open any page with `?peerReset=1` (or use **Settings → Use the default service**).

For a fixed deployment, define `window.DQB_PEER_OPTS` in a small script that loads before `shared/net.js`. It is passed straight to PeerJS, so besides `host`, `port`, `path` and `secure` it can carry a `config` with your own ICE servers:

```html
<script>
  window.DQB_PEER_OPTS = {
    host: 'peer.example.org', port: 443, path: '/', secure: true,
    config: { iceServers: [
      { urls: 'stun:stun.example.org:3478' },
      { urls: 'turn:turn.example.org:3478', username: 'class', credential: '…' }
    ] }
  };
</script>
```

PeerJS's defaults are Google's public STUN server and PeerJS's public TURN relays. Replacing `iceServers` as above (for example with an empty list for same-network classrooms, or your own coturn server) keeps those out of the picture.

## 3. Network requirements

- Outbound **HTTPS/WSS** to the PeerServer (the public one is `0.peerjs.com:443`).
- **WebRTC** (UDP) between devices. Devices on the same Wi-Fi connect directly; across networks the browsers use public STUN servers. If a firewall blocks all UDP, students cannot connect, and no PeerServer can fix that. Tell IT to allow WebRTC, or use a TURN server by passing `config: { iceServers: [...] }` in `DQB_PEER_OPTS`.
- Guest or "client isolation" Wi-Fi stops devices on the same network from talking to each other directly. Connections then depend on the router passing traffic back through its public address (STUN) or on a TURN relay, which is the reliable fix.

## 4. Updating

Deploy the new files. The service worker is network-first for HTML, JS and CSS, so users get changes on their next visit. If you change which files make up the app shell, bump `CACHE_VERSION` in `sw.js` so old caches are cleaned up.
