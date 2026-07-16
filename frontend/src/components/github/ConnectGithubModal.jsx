import { RiGithubLine } from 'react-icons/ri';
import Modal from '../ui/Modal.jsx';

const ConnectGithubModal = ({ isOpen, onClose, onContinue, loading = false }) => (
  <Modal
    isOpen={isOpen}
    onClose={onClose}
    title="Connect your GitHub Account"
    maxWidth="max-w-xl"
  >
    <div className="space-y-5">
      <p className="text-sm leading-6 text-text-muted">
        Smart Code Reviewer will connect the GitHub account that is currently signed in on github.com.
      </p>

      <div className="rounded-2xl border border-border bg-surface-2 p-4 text-sm text-text-muted">
        <p className="font-medium text-text-primary">The application will request permission to:</p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>Read your GitHub profile</li>
          <li>Read your email address</li>
          <li>Read your public repositories</li>
          <li>Read your private repositories (required for reviewing private repositories)</li>
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-surface-2 p-4 text-sm text-text-muted">
        <p className="font-medium text-text-primary">Security Note</p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>We only read repository data required for AI-powered code reviews.</li>
          <li>We never modify your repositories.</li>
          <li>Your GitHub access token is encrypted and stored securely.</li>
          <li>You can disconnect your GitHub account at any time.</li>
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-surface-2 p-4 text-sm text-text-muted">
        <p className="font-medium text-text-primary">Need to connect a different GitHub account?</p>
        <p className="mt-2 leading-6">
          GitHub authorizes the account currently signed into github.com in your browser.
        </p>
        <p className="mt-2 leading-6">
          To connect another GitHub account, switch accounts on github.com first, or open Smart Code Reviewer in an Incognito/Private window, then click Connect GitHub again.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-border bg-surface-2 px-4 py-2 text-sm font-medium text-text-primary transition hover:bg-surface-3"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-accent px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RiGithubLine className="text-base" />
          Continue to GitHub
        </button>
      </div>
    </div>
  </Modal>
);

export default ConnectGithubModal;
