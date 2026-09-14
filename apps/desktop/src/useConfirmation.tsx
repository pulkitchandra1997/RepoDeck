import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Request = { title: string; description: string; action: string };
export default function useConfirmation() {
  const [request, setRequest] = useState<Request | null>(null);
  const resolve = useRef<((accepted: boolean) => void) | null>(null);
  const element = useRef<HTMLElement>(null);
  const id = useId();
  function finish(accepted: boolean) {
    resolve.current?.(accepted);
    resolve.current = null;
    setRequest(null);
  }
  useEffect(() => () => { resolve.current?.(false); }, []);
  useEffect(() => {
    if (!request || !element.current) return;
    const previous = document.activeElement as HTMLElement | null;
    const background = [...document.body.children].filter(child => !child.contains(element.current) && !child.hasAttribute('inert'));
    background.forEach(child => child.setAttribute('inert', ''));
    element.current.querySelector('button')?.focus();
    return () => {
      background.forEach(child => child.removeAttribute('inert'));
      if (previous?.isConnected) previous.focus();
    };
  }, [request]);
  function confirm(value: Request): Promise<boolean> {
    if (resolve.current) return Promise.resolve(false);
    return new Promise(resolveRequest => { resolve.current = resolveRequest; setRequest(value); });
  }
  const confirmation = request && createPortal(
    <div className="modal-backdrop confirmation-backdrop">
      <section ref={element} className="settings confirmation" role="alertdialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); }
          if (event.key === 'Tab') {
            const buttons = element.current!.querySelectorAll('button');
            if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[1].focus(); }
            else if (!event.shiftKey && document.activeElement === buttons[1]) { event.preventDefault(); buttons[0].focus(); }
          }
        }}>
        <h2 id={`${id}-title`}>{request.title}</h2>
        <p id={`${id}-description`}>{request.description}</p>
        <div className="startup-actions">
          <button onClick={() => finish(false)}>Cancel</button>
          <button onClick={() => finish(true)}>{request.action}</button>
        </div>
      </section>
    </div>, document.body);
  return { confirm, confirmation };
}
