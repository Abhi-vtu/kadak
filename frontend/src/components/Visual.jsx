import React from 'react';
import { mono, burst, icons } from '../assets.js';

// The 86px (or sized) brand tile for a menu item: photo → beer crest → icon.
export default function Visual({ item, size = 86 }) {
  const color = item.color || 'yellow';
  const style = { width: size, height: size };
  if (item.image_url) {
    return (
      <span className={'visual v-' + color} style={style}>
        <img src={item.image_url} alt="" loading="lazy" />
      </span>
    );
  }
  if (item.icon === 'beer') {
    return (
      <span className={'visual crest v-' + color} style={style} aria-hidden="true">
        <svg className="burst" viewBox="0 0 100 100"><polygon points={burst} /></svg>
        <img className="mono" src={mono} alt="" />
      </span>
    );
  }
  const inner = icons[item.icon] || icons.plate;
  return (
    <span className={'visual v-' + color} style={style} aria-hidden="true">
      <svg viewBox="0 0 48 48" dangerouslySetInnerHTML={{ __html: inner }} />
    </span>
  );
}
