/**
 * LoadingScreen Component
 *
 * Full-viewport loading overlay used during:
 *  - Session restore (app boot)
 *  - Route guard loading
 *  - Data fetching with no content to show yet
 *
 * Props:
 *   message  : string  — optional label below spinner (default: "Loading...")
 *   color    : 'primary' | 'accent'  (default: 'primary')
 *   fullPage : boolean — if true fills 100vh, else fills parent container
 */

const colorMap = {
  primary: 'border-t-primary',
  accent:  'border-t-accent',
};

const LoadingScreen = ({
  message = 'Loading...',
  color = 'primary',
  fullPage = true,
}) => {
  const spinnerColor = colorMap[color] || colorMap.primary;

  return (
    <div
      className={`
        flex flex-col items-center justify-center gap-4
        ${fullPage ? 'min-h-screen' : 'min-h-[200px]'}
        bg-background
      `}
      role="status"
      aria-label={message}
    >
      {/* Spinner */}
      <div className="relative w-12 h-12">
        <div className="absolute inset-0 rounded-full border-2 border-border" />
        <div
          className={`absolute inset-0 rounded-full border-2 border-transparent ${spinnerColor} animate-spin`}
        />
      </div>

      {/* Message */}
      {message && (
        <p className="text-text-muted text-sm animate-pulse select-none">{message}</p>
      )}
    </div>
  );
};

export default LoadingScreen;
