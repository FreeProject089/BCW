// M17: a project's icon picked from the site's icon picker, not only uploaded.
//
// The pick is turned into what the icon field already stores, an image URL (see
// editor/glyph-image.js for why a name is not stored): the glyph's SVG in the chosen colour,
// uploaded like the file the Replace button takes. `onUrl(url)` then saves it exactly as an
// upload is saved, so there is one save path and one undo window for both.
import { useState } from 'react';
import { Shapes } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { uploadImage } from '../lib/api.js';
import { Button, Spinner, ColorInput, useToast } from '../ui/ui.jsx';
import IconPicker from '../editor/icon-picker.jsx';
import { glyphToImageUrl } from '../editor/glyph-image.js';

export default function ProjectIconPickButton({ onUrl, disabled }) {
  const { t } = useI18n(); const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [color, setColor] = useState('#f97316');
  const pick = async (name) => {
    setBusy(true);
    try { onUrl(await glyphToImageUrl(name, color, uploadImage)); }
    catch (x) {
      toast.error(x?.message === 'unsupported_icon'
        ? t('mA.pi.unsupported', 'That icon cannot be used as a project icon. Pick another one.')
        : t('mA.pi.failed', 'The icon could not be prepared. Try again, or upload an image.'));
    } finally { setBusy(false); }
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <ColorInput swatchOnly value={color} onChange={setColor} title={t('mA.pi.color', 'Colour of the glyph')}
        className="w-8 h-8 rounded-md border border-[var(--line)] shrink-0" />
      <Button size="sm" variant="ghost" disabled={disabled || busy} onClick={() => setOpen(true)}>
        {busy ? <Spinner /> : <Shapes size={13} />} {t('mA.pi.pick', 'Choose from the icons')}
      </Button>
      {open && <IconPicker title={t('mA.pi.title', 'Pick the project icon')} onClose={() => setOpen(false)} onPick={pick} />}
    </span>
  );
}
