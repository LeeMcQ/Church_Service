// SubRip (.srt) → WebVTT (.vtt) for <track> subtitles.
export function srtToVtt(text) {
  const s = String(text || '').replace(/\r/g, '').trim();
  if (/^WEBVTT/.test(s)) return s;
  const body = s.split(/\n\s*\n/).map((block) => {
    const lines = block.split('\n');
    if (/^\d+$/.test(lines[0].trim())) lines.shift();
    if (lines[0]) lines[0] = lines[0].replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, '$1.$2');
    return lines.join('\n');
  }).join('\n\n');
  return 'WEBVTT\n\n' + body + '\n';
}
