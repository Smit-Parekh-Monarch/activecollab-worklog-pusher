'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/Icon';

// Shared toast + confirm hook. Returns { toast, confirm, ui }:
//   toast(msg, 'ok'|'err'|'info')       — non-blocking notification (auto-dismisses)
//   confirm({ title, body?, items?, ok? }) — Promise<boolean>, styled modal (no native dialog)
//   ui                                  — render this once in the page
// Markup/classes match the existing .toasts/.toast/.overlay/.modal styles in globals.css.
export function useNotify() {
  const [toasts, setToasts] = useState<any[]>([]);
  const [modal, setModal] = useState<any>(null);
  const [mounted, setMounted] = useState(false);
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  // portal target — document.body — so overlays escape the page's animated/scrolled
  // container (a transformed ancestor otherwise traps position:fixed to its box)
  useEffect(() => { setMounted(true); }, []);

  const toast = useCallback((msg: string, type = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((ts) => [...ts, { id, msg, type }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 2800);
  }, []);

  const confirm = useCallback(
    (data: any): Promise<boolean> => new Promise((res) => { resolverRef.current = res; setModal(data); }),
    [],
  );
  const closeModal = (v: boolean) => {
    setModal(null);
    if (resolverRef.current) { resolverRef.current(v); resolverRef.current = null; }
  };

  const uiContent = (
    <>
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={'toast ' + (t.type || 'info')}>
            <Icon name={t.type === 'ok' ? 'check_circle' : t.type === 'err' ? 'error' : 'info'} />
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
      {modal ? (
        <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) closeModal(false); }}>
          <div className="modal" role="dialog" aria-modal="true">
            <div className="modal-head">
              <div className="modal-ic"><Icon name={modal.icon || 'rocket_launch'} /></div>
              <h3>{modal.title}</h3>
            </div>
            <div className="modal-body">
              {modal.body ? <span dangerouslySetInnerHTML={{ __html: modal.body }} /> : null}
              {modal.items ? (
                <div className="mlist">
                  {modal.items.map((t: any, i: number) => (
                    <div className="mlist-row" key={i}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name || '(no name)'}</span>
                      <span className="mh tnum">{(Number(t.hours) || 0).toFixed(2)}h</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="modal-actions">
              <Button variant="outline" onClick={() => closeModal(false)}>
                <Icon name="close" />{modal.cancel || 'Cancel'}
              </Button>
              <Button onClick={() => closeModal(true)}>
                <Icon name={modal.icon || 'rocket_launch'} />{modal.ok || 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );

  // render into <body> so the fixed overlay is centered on the viewport, not
  // trapped inside the page's animated/scrolled container
  const ui = mounted ? createPortal(uiContent, document.body) : null;

  return { toast, confirm, ui };
}
