//const cds = require("@sap/cds")
const { createAnonymizedView } = require("./lib/anonymization-helper.js")

if (cds.requires["cap-llm-plugin"]) {
  // we register ourselves to the cds once served event
  // a one-time event, emitted when all services have been bootstrapped and added to the express app
  cds.once('served', async () => {

    /**
     * anonymization features starts
     */

    // go through all services
    let schemaName = '', user = '';

    // go through all services
    for (let srv of cds.services) {
      if (srv.name === 'db') { schemaName = srv?.options?.credentials?.schema; }

      // go through all entities
      for (let entity of srv.entities) {
        let anonymizedElements = {}, anonymizeAlgorithm = '';
        // go through all elements in the entity and collect those with @anonymize annotation
        if (entity['@anonymize'] && entity.projection) {
          anonymizeAlgorithm = entity['@anonymize'];

          for (const key in entity.elements) {
            const element = entity.elements[key];
            // check if there is an annotation called anonymize on the element
            if (element['@anonymize']) { anonymizedElements[element.name] = element['@anonymize']; }
          }
          if (cds?.db?.kind === "hana") { createAnonymizedView(schemaName, entity.name, anonymizeAlgorithm, anonymizedElements); }
          else { console.warn("The anonymization feature is only supported with SAP HANA Cloud. Ensure the cds db is configured to use SAP HANA Cloud."); }
        }
      }
    }

  }
  )

}