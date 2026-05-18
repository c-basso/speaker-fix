'use strict';

const { listAppsCatalog } = require('../tasks/apps-catalog.js');

listAppsCatalog()
  .then((text) => console.log(text))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
