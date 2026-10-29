import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, getToken, setToken } from '../api.js';
import { logo } from '../assets.js';
import Visual from '../components/Visual.jsx';

const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');
const COLORS = ['yellow', 'orange', 'red', 'green', 'blue'];

export default function Manager() {
  const [authed, setAuthed] = useState(!!getToken());
  const [pw, setPw] = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [tab, setTab] = useState('menu');
  const [toast, setToast] = useState('');
  const toastT = useRef();

  function flash(m) { setToast(m); clearTimeout(toastT.current); toastT.current = setTimeout(() => setToast(''), 2200); }

  async function doLogin() {
    setLoginErr('');
    try { const r = await api.login(pw); setToken(r.token); setAuthed(true); }
    catch (e) { setLoginErr(/wrong/i.test(e.message) ? 'Wrong password — try again.' : e.message); }
  }
  function logout() { setToken(null); setAuthed(false); setPw(''); }

  if (!authed) {
    return (
      <div className="login">
        <img src={logo} alt="Kadak" />
        <h1>Manager Login</h1>
        <p>Kadak Brewpub · Thane</p>
        <input type="password" placeholder="Manager password" value={pw}
          onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doLogin()} autoFocus />
        <button onClick={doLogin}>Enter</button>
        <div className="err">{loginErr}</div>
      </div>
    );
  }

  return (
    <div className="wrap wide">
      <div className="mtop">
        <img src={logo} alt="Kadak" />
        <span className="who">Thane · <b>Manager</b></span>
        <span className="spacer" />
        <button onClick={logout}>Log out</button>
      </div>
      <div className="mtabs">
        <button className={tab === 'menu' ? 'on' : ''} onClick={() => setTab('menu')}>Menu</button>
        <button className={tab === 'analytics' ? 'on' : ''} onClick={() => setTab('analytics')}>Analytics</button>
      </div>
      {tab === 'menu' ? <MenuManager flash={flash} onAuthFail={logout} /> : <Analytics onAuthFail={logout} />}
      <div className={'toast' + (toast ? ' show' : '')}>{toast}</div>
    </div>
  );
}

/* ---------------- Menu manager ---------------- */
function MenuManager({ flash, onAuthFail }) {
  const [menu, setMenu] = useState(null);
  const [search, setSearch] = useState('');
  const [editItem, setEditItem] = useState(undefined); // undefined=closed, null=new, obj=edit
  const [editCat, setEditCat] = useState(undefined);

  const load = () => api.managerMenu().then(setMenu).catch((e) => { if (/unauth/i.test(e.message)) onAuthFail(); });
  useEffect(() => { load(); }, []);

  const cats = useMemo(() => (menu ? menu.groups.flatMap((g) => g.categories) : []), [menu]);
  const stats = useMemo(() => {
    const items = cats.flatMap((c) => c.items);
    const live = items.filter((i) => i.is_available).length;
    return { total: items.length, live, off: items.length - live };
  }, [cats]);

  async function toggle(it) {
    try { await api.updateItem(it.id, { is_available: !it.is_available }); flash(it.name + (!it.is_available ? ' is back on' : ' marked sold out')); load(); }
    catch (e) { flash(e.message); }
  }
  async function removeItem(it) {
    if (!confirm(`Delete "${it.name}"?`)) return;
    try { await api.deleteItem(it.id); flash('Item deleted'); load(); } catch (e) { flash(e.message); }
  }
  async function removeCat(c) {
    if (!confirm(`Delete category "${c.name}" and all its items?`)) return;
    try { await api.deleteCategory(c.id); flash('Category deleted'); load(); } catch (e) { flash(e.message); }
  }

  if (!menu) return <p className="muted">Loading…</p>;
  const term = search.trim().toLowerCase();

  return (
    <>
      <div className="stats">
        <div className="stat"><div className="n">{stats.total}</div><div className="l">Total items</div></div>
        <div className="stat live"><div className="n">{stats.live}</div><div className="l">Available</div></div>
        <div className="stat off"><div className="n">{stats.off}</div><div className="l">Sold out</div></div>
      </div>
      <div className="toolbar">
        <label className="search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#b4adaa" strokeWidth="2.4"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input type="search" placeholder="Find an item…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <button className="addnew" onClick={() => setEditCat(null)}>+ Category</button>
        <button className="addnew" onClick={() => setEditItem(null)}>+ Item</button>
      </div>

      {cats.map((c) => {
        const items = c.items.filter((i) => !term || (i.name + ' ' + (i.description || '')).toLowerCase().includes(term));
        if (!items.length) return null;
        return (
          <div className="mcat" key={c.id}>
            <h2>{c.name} <span className="w">{c.world}</span>
              <span className="cx">
                <button className="mini" onClick={() => setEditCat(c)}>Edit</button>
                <button className="mini" onClick={() => removeCat(c)}>Delete</button>
              </span>
            </h2>
            {items.map((it) => {
              const hasVar = it.variants && it.variants.length;
              const price = hasVar ? 'from ' + inr(Math.min(...it.variants.map((v) => v.price))) : inr(it.price);
              return (
                <div className={'mrow' + (it.is_available ? '' : ' off')} key={it.id}>
                  <Visual item={it} size={52} />
                  <div className="armeta">
                    <div className="arname">
                      {it.is_veg === true ? <span className="mark v" /> : it.is_veg === false ? <span className="mark n" /> : <span className="mark-none" />}
                      {it.name}
                    </div>
                    <div className="arsub">{price}{it.description ? ' · ' + it.description : ''}</div>
                  </div>
                  <div className="aractions">
                    <button className="iconbtn" title="Edit" onClick={() => setEditItem(it)}>
                      <svg viewBox="0 0 24 24"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                    </button>
                    <div className="swwrap">
                      <label className="sw"><input type="checkbox" checked={it.is_available} onChange={() => toggle(it)} /><span className="track" /><span className="knob" /></label>
                      <span className="swlabel">{it.is_available ? 'Available' : 'Sold out'}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {editItem !== undefined && (
        <ItemModal item={editItem} cats={cats} onClose={() => setEditItem(undefined)}
          onSaved={(msg) => { setEditItem(undefined); flash(msg); load(); }}
          onDelete={(it) => { removeItem(it); setEditItem(undefined); }} />
      )}
      {editCat !== undefined && (
        <CategoryModal cat={editCat} onClose={() => setEditCat(undefined)}
          onSaved={(msg) => { setEditCat(undefined); flash(msg); load(); }} />
      )}
    </>
  );
}

/* ---------------- Item modal ---------------- */
function ItemModal({ item, cats, onClose, onSaved, onDelete }) {
  const editing = !!item;
  const [name, setName] = useState(item?.name || '');
  const [desc, setDesc] = useState(item?.description || '');
  const [catId, setCatId] = useState(item?.category_id || (cats[0] && cats[0].id));
  const [veg, setVeg] = useState(item ? (item.is_veg === true ? 'v' : item.is_veg === false ? 'n' : 'na') : 'v');
  const [color, setColor] = useState(item?.color || 'yellow');
  const [flags, setFlags] = useState({ best: item?.is_bestseller || false, new: item?.is_new || false, sig: item?.is_signature || false });
  const [image, setImage] = useState(item?.image_url || null);
  const [useVariants, setUseVariants] = useState(!!(item?.variants && item.variants.length));
  const [price, setPrice] = useState(item?.price ?? '');
  const [variants, setVariants] = useState(item?.variants?.map((v) => ({ name: v.name, price: v.price })) || [{ name: '', price: '' }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef();

  async function pickImage(e) {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    setErr(''); setBusy(true);
    try { const r = await api.upload(f); setImage(r.url); } catch (ex) { setErr(ex.message); }
    setBusy(false); e.target.value = '';
  }

  async function save() {
    setErr('');
    if (!name.trim()) return setErr('Please enter a name.');
    const body = {
      name: name.trim(), description: desc.trim(), category_id: Number(catId), color,
      is_veg: veg === 'v' ? true : veg === 'n' ? false : null,
      is_bestseller: flags.best, is_new: flags.new, is_signature: flags.sig,
      image_url: image,
    };
    if (useVariants) {
      const vs = variants.map((v) => ({ name: v.name.trim(), price: Number(v.price) })).filter((v) => v.name && Number.isFinite(v.price));
      if (!vs.length) return setErr('Add at least one size/variant with a price.');
      body.variants = vs;
    } else {
      const p = Number(price);
      if (!Number.isFinite(p) || p < 0) return setErr('Enter a valid price.');
      body.price = p; body.variants = [];
    }
    setBusy(true);
    try {
      if (editing) await api.updateItem(item.id, body); else await api.addItem(body);
      onSaved(editing ? 'Item updated' : 'Item added');
    } catch (ex) { setErr(ex.message); setBusy(false); }
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal">
        <div className="modal-inner">
          <div className="mstrip"><i /><i /><i /><i /><i /></div>
          <h3>{editing ? 'Edit item' : 'Add item'}</h3>
          <div className="field"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kadak Lager" /></div>
          <div className="field"><label>Description</label><textarea value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
          <div className="grid2">
            <div className="field"><label>Section</label>
              <select value={catId} onChange={(e) => setCatId(e.target.value)}>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.world})</option>)}
              </select>
            </div>
            <div className="field"><label>Type</label>
              <div className="chips-row">
                {[['v', 'Veg'], ['n', 'Non-veg'], ['na', 'N/A']].map(([k, l]) => (
                  <button key={k} className={veg === k ? 'on' : ''} onClick={() => setVeg(k)}>{l}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="field"><label>Pricing</label>
            <div className="chips-row" style={{ marginBottom: 8 }}>
              <button className={!useVariants ? 'on' : ''} onClick={() => setUseVariants(false)}>Single price</button>
              <button className={useVariants ? 'on' : ''} onClick={() => setUseVariants(true)}>Sizes / variants</button>
            </div>
            {!useVariants ? (
              <input inputMode="numeric" placeholder="Price (₹)" value={price} onChange={(e) => setPrice(e.target.value)} />
            ) : (
              <div className="varedit">
                {variants.map((v, i) => (
                  <div className="vr" key={i}>
                    <input placeholder="Size / label (e.g. Pint)" value={v.name} onChange={(e) => setVariants((a) => a.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                    <input className="p" inputMode="numeric" placeholder="₹" value={v.price} onChange={(e) => setVariants((a) => a.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} />
                    <button onClick={() => setVariants((a) => a.filter((_, j) => j !== i))}>×</button>
                  </div>
                ))}
                <button className="addvar" onClick={() => setVariants((a) => [...a, { name: '', price: '' }])}>+ Add size</button>
              </div>
            )}
          </div>

          <div className="field"><label>Badges</label>
            <div className="chips-row">
              <button className={flags.best ? 'on' : ''} onClick={() => setFlags((f) => ({ ...f, best: !f.best }))}>Bestseller</button>
              <button className={flags.sig ? 'on' : ''} onClick={() => setFlags((f) => ({ ...f, sig: !f.sig }))}>Signature</button>
              <button className={flags.new ? 'on' : ''} onClick={() => setFlags((f) => ({ ...f, new: !f.new }))}>New</button>
            </div>
          </div>

          <div className="field"><label>Tile colour (used when there’s no photo)</label>
            <div className="colorrow">
              {COLORS.map((c) => <button key={c} className={color === c ? 'on' : ''} style={{ background: 'var(--' + c + ')' }} onClick={() => setColor(c)} />)}
            </div>
          </div>

          <div className="field"><label>Photo (optional)</label>
            <div className="imgpick">
              <div className="imgprev">{image ? <img src={image} alt="" /> : (busy ? 'Uploading…' : 'No photo')}</div>
              <div className="imgbtns">
                <button onClick={() => fileRef.current.click()}>Upload photo</button>
                {image && <button onClick={() => setImage(null)}>Remove</button>}
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />
            <div className="imghint">Resized and saved on the server; the photo’s URL is stored with the item.</div>
          </div>

          <button className="save" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save item'}</button>
          {editing && <button className="delete" onClick={() => onDelete(item)}>Delete item</button>}
          <div className="merr">{err}</div>
        </div>
      </div>
    </>
  );
}

/* ---------------- Category modal ---------------- */
function CategoryModal({ cat, onClose, onSaved }) {
  const editing = !!cat;
  const [name, setName] = useState(cat?.name || '');
  const [world, setWorld] = useState(cat?.world || 'food');
  const [desc, setDesc] = useState(cat?.sec_desc || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    setErr(''); if (!name.trim()) return setErr('Please enter a name.');
    setBusy(true);
    try {
      const body = { name: name.trim(), world, sec_desc: desc.trim() };
      if (editing) await api.updateCategory(cat.id, body); else await api.addCategory(body);
      onSaved(editing ? 'Category updated' : 'Category added');
    } catch (ex) { setErr(ex.message); setBusy(false); }
  }
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal">
        <div className="modal-inner">
          <div className="mstrip"><i /><i /><i /><i /><i /></div>
          <h3>{editing ? 'Edit category' : 'Add category'}</h3>
          <div className="field"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Small Plates" /></div>
          <div className="field"><label>Menu side</label>
            <div className="chips-row">
              <button className={world === 'food' ? 'on' : ''} onClick={() => setWorld('food')}>Food</button>
              <button className={world === 'drinks' ? 'on' : ''} onClick={() => setWorld('drinks')}>Drinks</button>
            </div>
          </div>
          <div className="field"><label>Short description (optional)</label><textarea value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
          <button className="save" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save category'}</button>
          <div className="merr">{err}</div>
        </div>
      </div>
    </>
  );
}

/* ---------------- Analytics ---------------- */
function Analytics({ onAuthFail }) {
  const [period, setPeriod] = useState('today');
  const [data, setData] = useState(null);
  useEffect(() => { setData(null); api.analytics(period).then(setData).catch((e) => { if (/unauth/i.test(e.message)) onAuthFail(); }); }, [period]);
  const max = data && data.top.length ? data.top[0].views : 1;
  return (
    <>
      <div className="stats">
        <div className="stat"><div className="n">{data ? data.total_views : '–'}</div><div className="l">Views · {period === 'today' ? 'today' : period === '7d' ? '7 days' : 'all time'}</div></div>
        <div className="stat"><div className="n">{data ? data.top.length : '–'}</div><div className="l">Items viewed</div></div>
      </div>
      <div className="seg">
        {[['today', 'Today'], ['7d', '7 days'], ['all', 'All time']].map(([k, l]) => (
          <button key={k} className={period === k ? 'on' : ''} onClick={() => setPeriod(k)}>{l}</button>
        ))}
      </div>
      {!data ? <p className="muted">Loading…</p> : data.top.length === 0 ? (
        <p className="muted">No views yet. Views are logged when guests open an item on the menu.</p>
      ) : (
        <div className="top-list">
          {data.top.map((t, i) => (
            <div className="top-row" key={t.item_id}>
              <div className="tr-top"><span>{i + 1}. {t.name}</span><b>{t.views}</b></div>
              <div className="top-bar"><i style={{ width: Math.round((t.views / max) * 100) + '%' }} /></div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
