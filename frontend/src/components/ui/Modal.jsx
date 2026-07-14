import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { RiCloseLine } from 'react-icons/ri';

const Modal = ({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = 'max-w-lg',
  showCloseButton = true,
}) => {
  const dialogRef = useRef(null);
  const previouslyFocusedElementRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    previouslyFocusedElementRef.current = document.activeElement;
    const focusableElements = dialogRef.current?.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    const firstFocusable = focusableElements?.[0];
    firstFocusable?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === 'Tab' && focusableElements && focusableElements.length > 0) {
        const first = focusableElements[0];
        const last = focusableElements[focusableElements.length - 1];

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
      previouslyFocusedElementRef.current?.focus();
    };
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 py-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              onClose();
            }
          }}
        >
          <motion.div
            ref={dialogRef}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            className={`w-full ${maxWidth} rounded-2xl border border-border bg-surface-1 p-6 shadow-2xl`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="modal-title" className="text-lg font-semibold text-text-primary">
                  {title}
                </h3>
              </div>

              {showCloseButton && (
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full p-2 text-text-muted transition hover:bg-surface-2 hover:text-text-primary"
                  aria-label="Close dialog"
                >
                  <RiCloseLine className="text-lg" />
                </button>
              )}
            </div>

            <div className="mt-4 text-sm leading-6 text-text-muted">{children}</div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};

export default Modal;
