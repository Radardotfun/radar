import { mountInline } from '../ui/radar.js';

const theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
mountInline(document.getElementById('radar'), theme).then((radar) => radar.open({}));
