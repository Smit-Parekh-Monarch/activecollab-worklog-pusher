'use client';
import { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

// Shared toast + confirm hook. Returns { toast, confirm, ui }:
//   toast(msg, 'ok'|'err'|'info')       — non-blocking notification (auto-dismisses)
//   confirm({ title, body?, items?, ok? }) — Promise<boolean>, styled modal (no native dialog)
//   ui                                  — render this once in the page
// Markup/classes match the existing .toasts/.toast/.overlay/.modal styles in globals.css.
export function useNotify() {
  const [toasts, setToasts] = useState<any[]>([]);
  const [modal, setModal] = useState<any>(null);
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

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

  const ui = (
    <>
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={'toast ' + (t.type || 'info')}>
            <ion-icon name={t.type === 'ok' ? 'checkmark-circle' : t.type === 'err' ? 'alert-circle' : 'information-circle'} />
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
      {modal ? (
        <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) closeModal(false); }}>
          <div className="modal" role="dialog" aria-modal="true">
            <div className="modal-head">
              <div className="modal-ic"><ion-icon name={modal.icon || 'rocket-outline'} /></div>
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
                <ion-icon name="close-outline" />{modal.cancel || 'Cancel'}
              </Button>
              <Button onClick={() => closeModal(true)}>
                <ion-icon name={modal.icon || 'rocket-outline'} />{modal.ok || 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );

  return { toast, confirm, ui };
}
