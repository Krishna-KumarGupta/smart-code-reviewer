import RepositoryList from '../components/github/RepositoryList.jsx';

const RepositoriesPage = () => {
  return (
    <div className="min-h-full">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <RepositoryList />
      </main>
    </div>
  );
};

export default RepositoriesPage;
