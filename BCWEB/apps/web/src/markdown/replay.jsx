// `:::replay`, drawn by B.MD itself.
//
// The other block the kit could not draw. It is not the same problem as the roadmap: a
// session recording genuinely needs a player, and bundling rrweb (~120 KB) into a markdown
// renderer so that a handful of documents can embed one would be the wrong trade for every
// project that never does.
//
// So this draws what it CAN, and says so where it cannot:
//
//   · a video or audio file        → the browser's own player, inline, no dependency
//   · an image                     → the image
//   · a recording (.bmmreplay, .json, anything else) → a card that opens the file
//
// and a host with a real player passes `replay={MyPlayer}` to replace all of it. The
// difference from before is that a document embedding a clip now works in a project that
// wired nothing, instead of showing a dashed box about a missing component.
import { useState } from 'react';
import { PlayCircle, Film, Download } from 'lucide-react';
import { safeUrl } from './url.js';
import { urlPolicy } from './config.js';

const VIDEO = /\.(mp4|webm|ogv|mov)(\?|#|$)/i;
const AUDIO = /\.(mp3|ogg|wav|m4a|flac)(\?|#|$)/i;
const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i;

export default function Replay({ src, title, autoplay = false, loop = false, lang = 'en' }) {
  const fr = lang === 'fr';
  // Through the same policy as every other URL in a document. A `:::replay{src=javascript:…}`
  // would otherwise be an anchor this file built by hand, outside the sanitiser's reach.
  const url = safeUrl(src, { kind: 'media', policy: urlPolicy() });
  const [failed, setFailed] = useState(false);

  if (!url.ok) {
    return (
      <div className="doc-replay doc-replay-empty">
        {fr ? 'Cet enregistrement n’a pas de source utilisable.' : 'This recording has no usable source.'}
      </div>
    );
  }

  const label = title || (fr ? 'Enregistrement' : 'Recording');

  // The browser plays these itself. `preload="metadata"` rather than `auto`: a page with
  // three clips on it should not download three videos before anybody presses anything.
  if (VIDEO.test(url.href) && !failed) {
    return (
      <figure className="doc-replay">
        <video className="doc-replay-media" src={url.href} controls playsInline preload="metadata"
          autoPlay={autoplay} loop={loop} muted={autoplay} onError={() => setFailed(true)}
          aria-label={label} />
        {title && <figcaption className="doc-replay-cap">{title}</figcaption>}
      </figure>
    );
  }
  if (AUDIO.test(url.href) && !failed) {
    return (
      <figure className="doc-replay">
        <audio className="doc-replay-audio" src={url.href} controls preload="metadata" aria-label={label} />
        {title && <figcaption className="doc-replay-cap">{title}</figcaption>}
      </figure>
    );
  }
  if (IMAGE.test(url.href) && !failed) {
    return (
      <figure className="doc-replay">
        <img className="doc-replay-media" src={url.href} alt={label} loading="lazy" onError={() => setFailed(true)} />
        {title && <figcaption className="doc-replay-cap">{title}</figcaption>}
      </figure>
    );
  }

  // Everything else: a link, honestly labelled. Not a fake player — a play button that opens
  // a download is worse than a card that says what it is.
  const attrs = url.external ? { target: '_blank', rel: 'noopener noreferrer' } : {};
  return (
    <a className="doc-replay doc-replay-card" href={url.href} {...attrs}>
      <span className="doc-replay-icon" aria-hidden>{failed ? <Film size={20} /> : <PlayCircle size={20} />}</span>
      <span className="doc-replay-text">
        <span className="doc-replay-title">{label}</span>
        <span className="doc-replay-sub">
          {failed
            ? (fr ? 'Ce média n’a pas pu être lu — ouvrir le fichier' : 'This media would not play — open the file')
            : (fr ? 'Ouvrir l’enregistrement' : 'Open the recording')}
        </span>
      </span>
      <Download size={15} aria-hidden className="doc-replay-dl" />
    </a>
  );
}
