const { DeletedUser, DeletedVehicle, DeletedInteraction } = require('../models/archiveModels');

// The only writers to the archive collections. `deletedBy` records which
// authenticated identity triggered the cascade.
const stamp = (doc, deletedBy) => ({ ...doc, deletedAt: new Date(), deletedBy });

exports.archiveUser = (userDoc, deletedBy) => DeletedUser.create(stamp(userDoc, deletedBy));

exports.archiveVehicles = (vehicleDocs, deletedBy) => (
    vehicleDocs.length
        ? DeletedVehicle.insertMany(vehicleDocs.map((v) => stamp(v, deletedBy)))
        : Promise.resolve([])
);

exports.archiveInteractions = (interactionDocs, deletedBy) => (
    interactionDocs.length
        ? DeletedInteraction.insertMany(interactionDocs.map((i) => stamp(i, deletedBy)))
        : Promise.resolve([])
);
