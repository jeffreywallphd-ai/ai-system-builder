export interface HomePageProps {
  onGoToArtifacts: () => void;
}

export function HomePage({ onGoToArtifacts }: HomePageProps) {
  return (
    <section className="ui-panel ui-stack ui-stack--sm">
      <h2>Build visual AI workflows from your artifacts</h2>
      <p>
        AI System Builder gives you a simple loop: upload data artifacts, browse what is stored, inspect details,
        and preview media in one place while you shape your system ideas.
      </p>
      <p className="ui-text-muted">Open Artifacts to start uploading and reviewing data artifacts.</p>
      <div>
        <button className="ui-button" type="button" onClick={onGoToArtifacts}>
          Open Artifacts workflow
        </button>
      </div>
    </section>
  );
}
