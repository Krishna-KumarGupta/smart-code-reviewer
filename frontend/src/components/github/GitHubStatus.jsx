/**
 * GitHubStatus
 *
 * A small inline indicator showing the GitHub connection state.
 * Shows a pulsing green dot + "Connected" or a grey dot + "Not connected".
 *
 * Props:
 *   connected : boolean
 *   username  : string|null
 *   size      : 'sm' | 'md' (default: 'md')
 */

const GitHubStatus = ({ connected, username, size = 'md' }) => {
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm';
  const dotSize  = size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2';

  if (connected) {
    return (
      <span className={`inline-flex items-center gap-2 ${textSize} font-medium text-emerald-400`}>
        <span className={`${dotSize} rounded-full bg-emerald-400 animate-pulse shrink-0`} />
        {username ? `@${username}` : 'Connected'}
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-2 ${textSize} font-medium text-text-muted`}>
      <span className={`${dotSize} rounded-full bg-gray-500 shrink-0`} />
      Not connected
    </span>
  );
};

export default GitHubStatus;
