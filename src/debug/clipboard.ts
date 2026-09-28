/** Copy text with the async Clipboard API, falling back to execCommand, then to a manual-copy dialog. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fall through
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (ok) return true;
  } catch {
    // fall through
  }
  showManualCopy(text);
  return false;
}

function showManualCopy(text: string): void {
  const dlg = document.createElement('div');
  dlg.className = 'modal';
  const ta = document.createElement('textarea');
  ta.value = text;
  const close = document.createElement('button');
  close.textContent = 'Close';
  close.onclick = () => dlg.remove();
  dlg.append(ta, close);
  document.body.append(dlg);
  ta.focus();
  ta.select();
}
