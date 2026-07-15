/**
 * HomePage — User Dashboard
 *
 * Protected page for authenticated users with role='user'.
 * Shows a welcome greeting, profile summary, quick stats,
 * GitHub connection and temporary repository testing.
 */

import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import {
  RiGithubLine,
  RiHistoryLine,
  RiCodeSSlashLine,
  RiShieldCheckLine,
  RiArrowRightLine,
  RiTimeLine,
} from 'react-icons/ri';

import useAuth from '../hooks/useAuth.js';
import Card from '../components/ui/Card.jsx';
import ConnectGitHubCard from '../components/github/ConnectGitHubCard.jsx';
import RepositoryList from '../components/github/RepositoryList.jsx';


// ─── Stat Card ────────────────────────────────────────────────────────────────

const StatCard = ({ icon, label, value, color, delay }) => (
  <motion.div
    initial={{ opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay, duration: 0.4 }}
    className="glass-card p-5 flex items-center gap-4"
  >
    <div
      className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0 ${color}`}
    >
      {icon}
    </div>

    <div>
      <p className="text-2xl font-bold text-text-primary">
        {value}
      </p>

      <p className="text-xs text-text-muted mt-0.5">
        {label}
      </p>
    </div>
  </motion.div>
);


// ─── Home Page ───────────────────────────────────────────────────────────────

const HomePage = () => {

  const { profile, githubConnected } = useAuth();


  const firstName =
    profile?.full_name?.split(' ')[0] || 'there';



  // Temporary repository test
  const testRepositories = async () => {
    try {

      const data = await githubService.getRepositories();

      console.log(
        "GitHub Repositories:",
        data
      );


      alert(
        `Found ${data.repositories.length} repositories`
      );


    } catch (error) {

      console.error(
        "Repository fetch failed:",
        error
      );


      alert(
        error?.response?.data?.error ||
        error.message ||
        "Failed to fetch repositories"
      );
    }
  };



  const syncRepositories = async () => {
    try {
      const result = await githubService.syncRepositories();
      console.log('Synced repositories:', result);
      toast.success('Repositories synced successfully');
    } catch (error) {
      console.error('Repository sync failed:', error);
      toast.error(error?.response?.data?.error || error.message || 'Failed to sync repositories');
    }
  };

  return (
    <div className="min-h-full">

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">


        {/* Hero Greeting */}

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-8"
        >

          <h2 className="text-3xl font-bold text-text-primary">

            Welcome back,
            <span className="gradient-text">
              {" "}{firstName}
            </span>
            {" "}👋

          </h2>


          <p className="text-text-muted mt-1 text-sm">
            Here's an overview of your Smart Code Reviewer dashboard.
          </p>

        </motion.div>



        {/* Stats Grid */}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">


          <StatCard
            icon={<RiCodeSSlashLine />}
            label="Total Reviews"
            value="0"
            color="bg-primary/10 text-primary"
            delay={0.1}
          />


          <StatCard
            icon={<RiShieldCheckLine />}
            label="Issues Found"
            value="0"
            color="bg-accent/10 text-accent"
            delay={0.15}
          />


          <StatCard
            icon={<RiHistoryLine />}
            label="This Week"
            value="0"
            color="bg-success/10 text-success"
            delay={0.2}
          />


          <StatCard
            icon={<RiTimeLine />}
            label="Avg Review Time"
            value="—"
            color="bg-warning/10 text-warning"
            delay={0.25}
          />


        </div>




        {/* Main Content Grid */}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">



          {/* GitHub Connection */}

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.4 }}
            className="lg:col-span-2"
          >

            <Card title="GitHub Connection" glass>

              <ConnectGitHubCard />

              {githubConnected && (
                <div className="mt-6">
                  <RepositoryList />
                </div>
              )}

            </Card>

          </motion.div>





          {/* Quick Links & Profile */}

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.4 }}
            className="space-y-4"
          >



            <Card title="Your Profile" glass>

              <div className="space-y-3">


                <div className="flex items-center gap-3">


                  <div
                    className="
                    w-10 h-10 rounded-full
                    bg-gradient-to-br
                    from-primary
                    to-accent
                    flex items-center
                    justify-center
                    text-white
                    font-bold
                    shrink-0"
                  >

                    {profile?.full_name?.charAt(0).toUpperCase() || 'U'}

                  </div>


                  <div className="min-w-0">

                    <p className="text-sm font-medium text-text-primary truncate">

                      {profile?.full_name || 'User'}

                    </p>


                    <p className="text-xs text-text-muted truncate">

                      {profile?.email}

                    </p>

                  </div>


                </div>



                <div className="pt-2 border-t border-border">


                  <div className="flex items-center justify-between">


                    <span className="text-xs text-text-muted">
                      Role
                    </span>


                    <span className="badge badge-primary">

                      {profile?.role || 'user'}

                    </span>


                  </div>


                </div>


              </div>


            </Card>




            <Card title="Quick Links" glass>


              <div className="space-y-2">


                <Link
                  to="/history"
                  className="
                  flex items-center
                  justify-between
                  p-3 rounded-xl
                  hover:bg-surface-2
                  transition-all
                  group"
                >

                  <div className="flex items-center gap-2.5 text-sm text-text-secondary">

                    <RiHistoryLine className="text-primary" />

                    Review History

                  </div>


                  <RiArrowRightLine
                    className="
                    text-text-muted
                    group-hover:text-primary
                    transition-colors
                    text-sm"
                  />


                </Link>



                <div
                  className="
                  flex items-center
                  justify-between
                  p-3 rounded-xl
                  opacity-40
                  cursor-not-allowed"
                >

                  <div className="flex items-center gap-2.5 text-sm text-text-secondary">

                    <RiGithubLine />

                    GitHub Repos

                  </div>


                  <span className="text-xs text-text-muted">
                    Soon
                  </span>


                </div>


              </div>


            </Card>


          </motion.div>


        </div>


      </main>


    </div>
  );
};


export default HomePage;