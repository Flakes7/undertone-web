"use strict";

globalThis.LyricTiming = (() => {
  const stamp = /\[(\d{1,3}):([0-5]?\d(?:[.,]\d{1,3})?)\]/g;
  const marker = /<(\d{1,3}):([0-5]?\d(?:[.,]\d{1,3})?)>/g;
  const seconds = (m, s) => Number(m) * 60 + Number(s.replace(",", "."));

  function voice(text) {
    const second = /^(?:v2|bg|background|backing)\s*:\s*/i;
    const backing = second.test(text) || /^\([\s\S]+\)$/.test(text);
    text = text.replace(/^(?:v[12]|bg|background|backing)\s*:\s*/i, "").trim();
    if (backing) text = text.replace(/^\((.*)\)$/, "$1").trim();
    return { text: text || "•••", backing, rest: !text };
  }

  function parse(source) {
    const offset = Number(source.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/im)?.[1] || 0) / 1000;
    const rows = [];
    for (const raw of source.replace(/^\uFEFF/, "").split(/\r\n|[\r\n]/)) {
      const line = raw.trim();
      let end = 0;
      const times = [];
      for (const match of line.matchAll(stamp)) {
        if (match.index !== end) break;
        times.push(seconds(match[1], match[2]));
        end += match[0].length;
      }
      if (!times.length) continue;
      const body = line.slice(end).trim();
      const plain = body.replace(marker, "");
      const marks = [...body.matchAll(marker)];
      for (const time of times) {
        const at = Math.max(0, time + offset);
        const lineVoice = voice(plain);
        const words = [];
        // Preserve whitespace between timed syllables. Voice labels and enclosing brackets stay off screen.
        if (marks.length && !lineVoice.backing && lineVoice.text === plain.trim()) {
          if (marks[0].index > 0) words.push({ at, text: body.slice(0, marks[0].index) });
          marks.forEach((mark, i) => {
            const text = body.slice(mark.index + mark[0].length, marks[i + 1]?.index ?? body.length);
            if (text) words.push({ at: seconds(mark[1], mark[2]) + offset + time - times[0], text });
          });
        }
        const inline = !marks.length && !lineVoice.backing && lineVoice.text.match(/^(.+?)\s+\(([^()]+)\)$/);
        if (inline) {
          rows.push({ at, ...voice(inline[1]), words: [] }, { at, ...voice("(" + inline[2] + ")"), words: [] });
        } else {
          rows.push({ at, ...lineVoice, words });
        }
      }
    }
    rows.sort((a, b) => a.at - b.at);
    const clean = rows.filter((row, i) => i === 0 || row.at !== rows[i - 1].at || row.text !== rows[i - 1].text);
    if (clean.length && clean[0].at > 1) clean.unshift({ at: 0, ...voice(""), words: [] });
    return clean;
  }

  function active(rows, t) {
    let lo = 0, hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (rows[mid].at <= t) lo = mid + 1;
      else hi = mid;
    }
    let index = Math.max(0, lo - 1);
    while (index > 0 && rows[index - 1].at === rows[index].at) index--;
    return index;
  }
  return { parse, active, voice };
})();
