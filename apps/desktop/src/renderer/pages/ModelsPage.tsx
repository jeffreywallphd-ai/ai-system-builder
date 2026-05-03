import { ModelsFeature } from "../features/models";

export function ModelsPage() {
  return (
    <section className="ui-stack ui-stack--sm">
      <h1>Model Management</h1>
      <p>Browse remote model references, manage model asset records, and prepare future training workflows.</p>
      <ModelsFeature />
    </section>
  );
}
