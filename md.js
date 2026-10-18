/* Небольшой парсер Markdown без зависимостей. Поддерживает то, что реально нужно в заметках:
   заголовки, абзацы, списки, цитаты, код, таблицы, ссылки, картинки, жирный/курсив/зачёркнутый. */
(function (global) {
  'use strict';

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function safeUrl(url) {
    url = url.trim();
    return /^(https?:|mailto:|#|\/|\.\/|[\w-]+\.(png|jpe?g|gif|svg|webp)$)/i.test(url) ? url : '#';
  }

  function emph(text) {
    return text
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>');
  }

  function inline(text) {
    var codes = [], tags = [];
    text = esc(text).replace(/`([^`]+)`/g, function (_, c) { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
    // Картинки и ссылки убираем в плейсхолдеры до жирного/курсива, чтобы звёздочки в адресе не превращались в теги
    var hold = function (html) { tags.push(html); return '\u0001' + (tags.length - 1) + '\u0001'; };
    text = text
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (_, alt, src) {
        alt = alt.replace(/\u0000(\d+)\u0000/g, function (_, i) { return codes[+i]; });
        return hold('<img alt="' + alt + '" src="' + safeUrl(src) + '">');
      })
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, t, href) { return hold('<a href="' + safeUrl(href) + '" target="_blank" rel="noopener">' + emph(t) + '</a>'); });
    text = emph(text).replace(/\u0001(\d+)\u0001/g, function (_, i) { return tags[+i]; });
    return text.replace(/\u0000(\d+)\u0000/g, function (_, i) { return '<code>' + codes[+i] + '</code>'; });
  }

  function slug(s) {
    return s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\wа-яё\s-]/gi, '').trim().replace(/\s+/g, '-');
  }

  // Одинаковые заголовки получают id с суффиксом: intro, intro-2, intro-3
  function uniqueId(id, seen) {
    if (!seen[id]) { seen[id] = 1; return id; }
    var n = seen[id];
    do { n++; } while (seen[id + '-' + n]);
    seen[id] = n; seen[id + '-' + n] = 1;
    return id + '-' + n;
  }

  function parse(src, seen) {
    seen = seen || Object.create(null);
    var lines = src.replace(/\r\n?/g, '\n').split('\n'), out = [], i = 0, toc = [];
    while (i < lines.length) {
      var line = lines[i];
      if (/^```/.test(line)) {
        var lang = line.slice(3).trim(), code = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
        i++;
        out.push('<pre><code' + (lang ? ' class="lang-' + esc(lang) + '"' : '') + '>' + esc(code.join('\n')) + '</code></pre>');
        continue;
      }
      var h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        var lvl = h[1].length, html = inline(h[2]), id = uniqueId(slug(h[2]), seen);
        if (lvl <= 3) toc.push({ lvl: lvl, text: h[2], id: id });
        out.push('<h' + lvl + ' id="' + id + '">' + html + '</h' + lvl + '>');
        i++; continue;
      }
      if (/^(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
      if (/^>\s?/.test(line)) {
        var q = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
        out.push('<blockquote>' + parse(q.join('\n'), seen).html + '</blockquote>');
        continue;
      }
      if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
        var ordered = /^\s*\d+\./.test(line), items = [];
        while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
          var item = lines[i++].replace(/^\s*([-*+]|\d+\.)\s+/, ''), task = item.match(/^\[([ xX])\]\s+(.*)/);
          items.push(task ? '<li class="task"><input type="checkbox" disabled' + (task[1] !== ' ' ? ' checked' : '') + '> ' + inline(task[2]) + '</li>' : '<li>' + inline(item) + '</li>');
        }
        out.push(ordered ? '<ol>' + items.join('') + '</ol>' : '<ul>' + items.join('') + '</ul>');
        continue;
      }
      if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1])) {
        var cells = function (l) { return l.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); }); };
        var head = cells(line), rows = [];
        i += 2;
        while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
        out.push('<table><thead><tr>' + head.map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>');
        continue;
      }
      if (!line.trim()) { i++; continue; }
      var para = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|\s*([-*+]|\d+\.)\s|\|)/.test(lines[i])) para.push(lines[i++]);
      if (!para.length) para.push(lines[i++]);
      out.push('<p>' + para.map(inline).join('<br>') + '</p>');
    }
    return { html: out.join('\n'), toc: toc };
  }

  global.Markdown = { parse: function (src) { return parse(src); } };
  if (typeof module !== 'undefined') module.exports = global.Markdown;
})(this);
