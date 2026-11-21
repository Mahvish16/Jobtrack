import Icon from "./Icon";

function StatCard({ title, value, icon, color }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${color}`}>
        <Icon name={icon} size={20} />
      </div>

      <div>
        <p>{title}</p>
        <h3>{value}</h3>
      </div>
    </div>
  );
}

function StatsGrid({ loading, jobs }) {
  const count = (status) =>
    loading ? "—" : jobs.filter((job) => job.status === status).length;

  return (
    <section className="stats-grid">
      <StatCard
        title="Total Applications"
        value={loading ? "—" : jobs.length}
        icon="document"
        color="purple"
      />
      <StatCard title="Applied" value={count("Applied")} icon="send" color="blue" />
      <StatCard
        title="Interviews"
        value={count("Interview")}
        icon="users"
        color="orange"
      />
      <StatCard
        title="Selected"
        value={count("Selected")}
        icon="check-circle"
        color="green"
      />
    </section>
  );
}

export default StatsGrid;
