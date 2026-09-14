const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');

function luminance(rgb) {
  const values = rgb.match(/[\d.]+/g).map(Number);
  assert.ok(values.length === 3 || (values.length === 4 && values[3] === 1), 'Contrast fixtures require opaque RGB colors');
  const channels = values.slice(0, 3).map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const failures = [], results = [];
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><head></head><body></body></html>');
    await page.addStyleTag({ content: await fs.readFile('apps/desktop/src/styles.css', 'utf8') });
    for (const [theme, system] of [['light', 'light'], ['dark', 'dark'], ['system', 'light'], ['system', 'dark']]) {
      await page.emulateMedia({ colorScheme: system });
      const samples = await page.evaluate(theme => {
        document.documentElement.dataset.theme = theme;
        const samples = [];
        for (const background of ['surface', 'sidebar', 'hover']) {
          for (const role of ['text', 'muted', 'accent', 'amber', 'danger', 'warnings']) {
            const host = document.createElement('div');
            host.style.backgroundColor = `var(--${background})`;
            const label = document.createElement('span');
            label.textContent = 'Repository status';
            if (['text', 'muted', 'accent'].includes(role)) label.style.color = `var(--${role})`;
            else label.className = role;
            host.append(label); document.body.append(host);
            samples.push({ role, background, foreground: getComputedStyle(label).color, backing: getComputedStyle(host).backgroundColor });
            host.remove();
          }
        }
        return samples;
      }, theme);
      for (const sample of samples) {
        const a = luminance(sample.foreground), b = luminance(sample.backing);
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        const result = { theme: `${theme}/${system}`, ...sample, ratio };
        results.push(result);
        if (ratio < 4.5) failures.push(`${result.theme} ${sample.role} on ${sample.background}: ${ratio.toFixed(2)}:1`);
      }
    }
    await fs.mkdir('.tools', { recursive: true });
    await fs.writeFile('.tools/contrast-results.json', JSON.stringify(results, null, 2));
    assert.equal(failures.length, 0, failures.join('\n'));
    console.log(`PASS: ${results.length} theme/text/background combinations meet 4.5:1; minimum ${Math.min(...results.map(result => result.ratio)).toFixed(2)}:1.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
