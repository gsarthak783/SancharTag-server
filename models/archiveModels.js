const mongoose = require('mongoose');

// Soft-delete archives. strict:false because they store point-in-time copies of
// documents whose schemas will evolve. There are NO public write endpoints —
// only archiveService writes here, always adding { deletedAt, deletedBy }.
const archiveSchema = () => new mongoose.Schema({}, { strict: false, timestamps: true });

const DeletedUser = mongoose.model('DeletedUser', archiveSchema());
const DeletedVehicle = mongoose.model('DeletedVehicle', archiveSchema());
const DeletedInteraction = mongoose.model('DeletedInteraction', archiveSchema());

module.exports = { DeletedUser, DeletedVehicle, DeletedInteraction };
