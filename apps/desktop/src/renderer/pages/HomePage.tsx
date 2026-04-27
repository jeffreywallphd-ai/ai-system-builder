export interface HomePageProps {
  onGoToArtifacts: () => void;
}

export function HomePage({ onGoToArtifacts }: HomePageProps) {
  return (
    <section className="ui-panel ui-stack ui-stack--sm">
      <h2 className="ui-panel__title">Build visual AI workflows from your artifacts</h2>
      <p>
        AI System Builder helps you upload images, keep them organized as artifacts, and inspect metadata with quick
        previews while you iterate on system ideas.
      </p>
      <p className="ui-text-muted">
        Start by opening the Artifacts page to upload an image, browse existing artifacts, and preview content.
      </p>
      <div>
        <button className="ui-button" type="button" onClick={onGoToArtifacts}>
          Open Artifacts workflow
        </button>
      </div>
    </section>
  );
}
