import { createPainterUI } from '../src/index.js';

const app = document.getElementById('app')!;

const ui = createPainterUI(app, {
  width: 1920,
  height: 1080,
  mode: 'vector',
  name: '그림1',
  style: { fill: '#2f6df6', stroke: '#17243a', strokeWidth: 8 },
  brush: { size: 22 },
  text: { fontSize: 96 },
  vectorize: { maxColors: 16, epsilon: 1.2, smooth: true },
});

const painter = ui.painter;
(window as unknown as { painter: typeof painter }).painter = painter;

document.getElementById('sample')!.addEventListener('click', () => {
  const vector = painter.vector;
  if (!vector) return;
  vector.createPath('M 220 780 C 380 380 700 260 960 470 C 1220 680 1480 600 1700 380', {
    fill: null,
    stroke: '#16a0d8',
    strokeWidth: 24,
  });
  const blob = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
  blob.setAttribute('cx', '620');
  blob.setAttribute('cy', '620');
  blob.setAttribute('rx', '250');
  blob.setAttribute('ry', '180');
  blob.setAttribute('fill', '#2f6df6');
  blob.setAttribute('stroke', '#17243a');
  blob.setAttribute('stroke-width', '8');
  vector.addItem(blob as unknown as SVGGraphicsElement);
  vector.commit();
});

document.getElementById('export')!.addEventListener('click', () => {
  const data = painter.export();
  const blob = painter.isVector
    ? new Blob([data], { type: 'image/svg+xml' })
    : dataURLToBlob(data);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${ui.name || '그림'}.${painter.isVector ? 'svg' : 'png'}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

function dataURLToBlob(dataURL: string): Blob {
  const [head, body] = dataURL.split(',');
  const mime = /:(.*?);/.exec(head)?.[1] ?? 'image/png';
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
