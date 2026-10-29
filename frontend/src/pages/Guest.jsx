import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { logo } from '../assets.js';
import Visual from '../components/Visual.jsx';

const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');
const tracked = new Set();

export default function Guest() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('food');
  const [diet, setDiet] = useState(null);
  const [term, setTerm] = useState('');
  const [openVar, setOpenVar] = useState({});
  const [activeChip, setActiveChip] = useState('');
  const [showTop, setShowTop] = useState(false);
  const secRefs = useRef({});

  useEffect(() => {
    api.getMenu().then(setData).catch((e) => setErr(e.message));
  }, []);
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 600);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const searching = term.trim().length > 0;
  const q = term.trim().toLowerCase();

  const matches = (it) => {
    const okDiet = !diet || (diet === 'v' && it.is_veg === true) || (diet === 'n' && it.is_veg === false) || it.is_veg === null;
    const hay = (it.name + ' ' + (it.description || '') + ' ' + it.variants.map((v) => v.name).join(' ')).toLowerCase();
    const okTerm = !q || hay.indexOf(q) > -1;
    return okDiet && okTerm;
  };

  // visible groups/categories after tab + filters
  const view = useMemo(() => {
    if (!data) return [];
    return data.groups
      .filter((g) => searching || g.world === tab)
      .map((g) => ({
        ...g,
        categories: g.categories
          .map((c) => ({ ...c, items: c.items.filter(matches) }))
          .filter((c) => c.items.length),
      }))
      .filter((g) => g.categories.length);
  }, [data, tab, diet, q, searching]);

  const allCats = useMemo(() => view.flatMap((g) => g.categories), [view]);

  // scrollspy
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) setActiveChip(e.target.id); }),
      { rootMargin: '-40% 0px -55% 0px' }
    );
    allCats.forEach((c) => { const el = secRefs.current[c.slug]; if (el) io.observe(el); });
    return () => io.disconnect();
  }, [allCats]);

  const pickTab = (t) => { setTab(t); setTerm(''); window.scrollTo({ top: 0 }); };
  const jump = (slug) => { const el = secRefs.current[slug]; if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const toggleVar = (id) => {
    setOpenVar((s) => ({ ...s, [id]: !s[id] }));
    if (!tracked.has(id)) { tracked.add(id); api.track(id); }
  };
  const onTapItem = (id) => { if (!tracked.has(id)) { tracked.add(id); api.track(id); } };

  if (err) return <div className="loading">Couldn’t load the menu.<br />{err}</div>;
  if (!data) return <div className="loading">Loading the menu…</div>;

  return (
    <>
      <div className="strip" aria-hidden="true"><i /><i /><i /><i /><i /></div>
      <div className="wrap">
        <header className="hero">
          <img className="logo" src={logo} alt="Kadak — Indian Craft Beer" />
          <div className="outlet">BrewPub · <b>Thane</b> · Wagle Estate</div>
        </header>

        <div className="controls">
          <div className="worldtabs" role="tablist">
            <button className={'worldtab' + (tab === 'food' ? ' on' : '')} onClick={() => pickTab('food')}><span aria-hidden="true">🍽</span>Food</button>
            <button className={'worldtab' + (tab === 'drinks' ? ' on' : '')} onClick={() => pickTab('drinks')}><span aria-hidden="true">🍺</span>Drinks</button>
          </div>
          <div className="searchrow">
            <label className="search">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f4f1ec" strokeWidth="2.4"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
              <input type="search" placeholder="Search the menu…" value={term} onChange={(e) => setTerm(e.target.value)} />
            </label>
            <div className="diet">
              <button className={'veg' + (diet === 'v' ? ' on' : '')} onClick={() => setDiet(diet === 'v' ? null : 'v')}><span className="mark v" style={{ width: 11, height: 11 }} />Veg</button>
              <button className={'nonveg' + (diet === 'n' ? ' on' : '')} onClick={() => setDiet(diet === 'n' ? null : 'n')}><span className="mark n" style={{ width: 11, height: 11 }} />Non-veg</button>
            </div>
          </div>
          <nav className="chiprail">
            {allCats.map((c) => (
              <button key={c.slug} className={'chip' + (activeChip === c.slug ? ' active' : '')} onClick={() => jump(c.slug)}>{c.name}</button>
            ))}
          </nav>
        </div>

        {view.length === 0 && <p className="muted">Nothing matches that — try clearing the search or filters.</p>}

        {view.map((g) => (
          <React.Fragment key={g.world + (searching ? '-s' : '')}>
            {searching && <p className="grouptag">{g.label}</p>}
            {g.categories.map((c) => (
              <section key={c.slug} id={c.slug} ref={(el) => (secRefs.current[c.slug] = el)}>
                <div className="sec-head"><h3>{c.name}</h3><span className="count">{c.items.length} {c.items.length === 1 ? 'item' : 'items'}</span></div>
                {c.sec_desc && <p className="sec-desc">{c.sec_desc}</p>}
                <div className="card">
                  {c.items.map((it) => {
                    const hasVar = it.variants && it.variants.length > 0;
                    const minP = hasVar ? Math.min(...it.variants.map((v) => v.price)) : it.price;
                    return (
                      <div key={it.id} className="item">
                        <div className="item-row" onClick={() => onTapItem(it.id)}>
                          <div className="item-main">
                            {it.is_veg === true ? <span className="mark v" /> : it.is_veg === false ? <span className="mark n" /> : <span className="mark-none" />}
                            <div className="item-txt">
                              <div className="item-name">{it.name}</div>
                              {it.description && <p className="item-desc">{it.description}</p>}
                              <div className="price">{hasVar ? 'from ' + inr(minP) : inr(it.price)}</div>
                              <div className="tags">
                                {it.is_bestseller && <span className="tag best">Bestseller</span>}
                                {it.is_signature && <span className="tag pick">Signature</span>}
                                {it.is_new && <span className="tag new">New</span>}
                              </div>
                            </div>
                          </div>
                          <div className="rightcol">
                            <Visual item={it} />
                            {hasVar && <button className="optbtn" onClick={() => toggleVar(it.id)}>{openVar[it.id] ? 'Hide ▴' : 'Sizes ▾'}</button>}
                          </div>
                        </div>
                        {hasVar && openVar[it.id] && (
                          <div className="varpanel">
                            {it.variants.map((v) => (
                              <div className="vrow" key={v.id}><span className="vn">{v.name}</span><span className="vp">{inr(v.price)}</span></div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </React.Fragment>
        ))}

        <footer>
          <img src={logo} alt="" />
          <p>{data.restaurant?.address}</p>
          <p>{data.restaurant?.hours}</p>
          <p className="legal">Government taxes as applicable. Please inform staff of any allergies.</p>
        </footer>
      </div>

      <div className="strip" aria-hidden="true" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 25 }}><i /><i /><i /><i /><i /></div>
      <button className={'totop' + (showTop ? ' show' : '')} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Back to top">↑</button>
    </>
  );
}
