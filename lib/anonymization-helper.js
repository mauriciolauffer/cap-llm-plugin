async function createAnonymizedView(schemaName, entityName, anonymizeAlgorithm, anonymizedElements) {
  let entityViewName = entityName.toUpperCase().replace(/\./g, '_'), view_name = entityName.toUpperCase().replace(/\./g, '_') + '_ANOMYZ_V', anonymizedViewQuery = '';
  let viewExists = await cds.db.run(`SELECT count(1) as \"count\" FROM SYS.VIEWS where VIEW_NAME='${view_name}' and SCHEMA_NAME='${schemaName}'`);

  //check if anonymized view already exists. If already present, drop it.
  if (viewExists[0].count === 1) {
    try {
      await cds.db.run(`drop view "${view_name}"`);
      console.log(`Anonymized view '${view_name}' dropped.`);
    } catch (e) {
      console.log(`Cannot drop view "${view_name}" . Error: `, e);
      throw e;
    }
  }
  console.log(`Creating anonymized view "${view_name}" in HANA.`);

  //Dynamically construct anonymization create view query and execute it
  anonymizedViewQuery += ` CREATE VIEW "${view_name}" AS SELECT ${Object.keys(anonymizedElements).map(item => `"${item.toUpperCase()}"`).join(", ")}`;
  anonymizedViewQuery += ` FROM "${entityViewName}" \n WITH ANONYMIZATION  (${anonymizeAlgorithm}\n`;
  for (let [key, value] of Object.entries(anonymizedElements)) { anonymizedViewQuery += `COLUMN "${key.toUpperCase()}" PARAMETERS '${value}'\n`; }

  anonymizedViewQuery += `)`;
  try {
    await cds.db.run(anonymizedViewQuery);
    console.log(`Anonymized view "${view_name}" created in HANA.`);
  }
  catch (e) {
    console.log(`Creating of anonymized view "${view_name}" failed. Error: `, e);
    throw e;
  }

  try {
    //refresh the anonymized view 
    await cds.db.run(`REFRESH VIEW "${view_name}" ANONYMIZATION`);
    console.log(`Refreshed Anonymized view "${view_name}" in HANA.`);
  }
  catch (e) {
    console.log(`Refreshing anonymized view "${view_name}" failed. Error: `, e);
    throw e;
  }
}

module.exports = { createAnonymizedView };