import { expect } from 'chai';
import { on } from 'events';

import { MongoClient, MongoError, ObjectId, ReturnDocument } from '../../mongodb';
import { assert as test } from '../shared';

// instanceof cannot be use reliably to detect the new models in js due to scoping and new
// contexts killing class info find/distinct/count thus cannot be overloaded without breaking
// backwards compatibility in a fundamental way

const DB_NAME = 'crud_api_tests';

describe('CRUD API', function () {
  let client: MongoClient;

  beforeEach(async function () {
    client = this.configuration.newClient();

    client.s.options.dbName = DB_NAME; // setup the default db

    const utilClient = this.configuration.newClient();
    await utilClient
      .db(DB_NAME)
      .dropDatabase()
      .catch(() => null); // clear out ns
    await utilClient
      .db(DB_NAME)
      .createCollection('test')
      .catch(() => null); // make ns exist
    await utilClient.close();
  });

  afterEach(async function () {
    await client?.close();
    client = null;

    const cleanup = this.configuration.newClient();
    await cleanup
      .db(DB_NAME)
      .dropDatabase()
      .catch(() => null);

    await cleanup.close();
  });

  it('should correctly execute findOne method using crud api', async function () {
    const db = client.db();
    const collection = db.collection('t');

    await collection.insertOne({ findOneTest: 1 });

    const findOneResult = await collection.findOne({ findOneTest: 1 });

    expect(findOneResult).to.have.property('findOneTest', 1);
    expect(findOneResult).to.have.property('_id').that.is.instanceOf(ObjectId);

    const findNoneResult = await collection.findOne({ findOneTest: 2 });
    expect(findNoneResult).to.be.null;

    await collection.drop();
    await client.close();
  });

  context('when creating a cursor with find', () => {
    let collection;

    beforeEach(async () => {
      collection = client.db().collection('t');
      await collection.drop().catch(() => null);
      await collection.insertMany([{ a: 1 }, { a: 1 }, { a: 1 }, { a: 1 }]);
    });

    afterEach(async () => {
      await collection?.drop().catch(() => null);
    });

    const makeCursor = () => {
      // Possible methods on the the cursor instance
      return collection
        .find({})
        .filter({ a: 1 })
        .addCursorFlag('noCursorTimeout', true)
        .addQueryModifier('$comment', 'some comment')
        .batchSize(1)
        .comment('some comment 2')
        .limit(2)
        .maxTimeMS(50)
        .project({ a: 1 })
        .skip(0)
        .sort({ a: 1 });
    };

    describe('#count()', () => {
      it('returns the number of documents', async () => {
        const cursor = makeCursor();
        const res = await cursor.count();
        expect(res).to.equal(2);
      });
    });

    describe('#forEach()', () => {
      it('iterates all the documents', async () => {
        const cursor = makeCursor();
        let count = 0;
        await cursor.forEach(() => {
          count += 1;
        });
        expect(count).to.equal(2);
      });
    });

    describe('#toArray()', () => {
      it('returns an array with all documents', async () => {
        const cursor = makeCursor();
        const res = await cursor.toArray();
        expect(res).to.have.lengthOf(2);
      });
    });

    describe('#next()', () => {
      it('is callable without blocking', async () => {
        const cursor = makeCursor();
        const doc0 = await cursor.next();
        expect(doc0).to.exist;
        const doc1 = await cursor.next();
        expect(doc1).to.exist;
        const doc2 = await cursor.next();
        expect(doc2).to.not.exist;
      });
    });

    describe('#stream()', () => {
      it('creates a node stream that emits data events', async () => {
        const count = 0;
        const cursor = makeCursor();
        const stream = cursor.stream();
        on(stream, 'data');
        cursor.once('close', function () {
          expect(count).to.equal(2);
        });
      });
    });

    describe('#explain()', () => {
      it('returns an explain document', async () => {
        const cursor = makeCursor();
        const result = await cursor.explain();
        expect(result).to.exist;
      });
    });
  });

  it('should correctly execute aggregation method using crud api', function (done) {
    const db = client.db();

    db.collection('t1').insertMany([{ a: 1 }, { a: 1 }, { a: 2 }, { a: 1 }], function (err) {
      expect(err).to.not.exist;

      const testAllMethods = function () {
        // Get the cursor
        const cursor = db.collection('t1').aggregate([{ $match: {} }], {
          allowDiskUse: true,
          batchSize: 2,
          maxTimeMS: 50
        });

        // Exercise all the options
        cursor
          .geoNear({ geo: 1 })
          .group({ group: 1 })
          .limit(10)
          .match({ match: 1 })
          .maxTimeMS(10)
          .out('collection')
          .project({ project: 1 })
          .redact({ redact: 1 })
          .skip(1)
          .sort({ sort: 1 })
          .batchSize(10)
          .unwind('name');

        // Execute the command with all steps defined
        // will fail
        cursor.toArray(function (err) {
          test.ok(err != null);
          testToArray();
        });
      };

      //
      // Exercise toArray
      // -------------------------------------------------
      const testToArray = function () {
        const cursor = db.collection('t1').aggregate();
        cursor.match({ a: 1 });
        cursor.toArray(function (err, docs) {
          expect(err).to.not.exist;
          test.equal(3, docs.length);
          testNext();
        });
      };

      //
      // Exercise next
      // -------------------------------------------------
      const testNext = function () {
        const cursor = db.collection('t1').aggregate();
        cursor.match({ a: 1 });
        cursor.next(function (err) {
          expect(err).to.not.exist;
          testEach();
        });
      };

      //
      // Exercise each
      // -------------------------------------------------
      const testEach = function () {
        let count = 0;
        const cursor = db.collection('t1').aggregate();
        cursor.match({ a: 1 });
        cursor.forEach(
          () => {
            count = count + 1;
          },
          err => {
            expect(err).to.not.exist;
            test.equal(3, count);
            testStream();
          }
        );
      };

      //
      // Exercise stream
      // -------------------------------------------------
      const testStream = function () {
        const cursor = db.collection('t1').aggregate();
        let count = 0;
        cursor.match({ a: 1 });
        const stream = cursor.stream();
        stream.on('data', function () {
          count = count + 1;
        });

        stream.once('end', function () {
          test.equal(3, count);
          testExplain();
        });
      };

      //
      // Explain method
      // -------------------------------------------------
      const testExplain = function () {
        const cursor = db.collection('t1').aggregate();
        cursor.explain(function (err, result) {
          expect(err).to.not.exist;
          test.ok(result != null);

          client.close(done);
        });
      };

      testAllMethods();
    });
  });

  it('should correctly execute insert methods using crud api', function (done) {
    client.connect(function (err, client) {
      const db = client.db();

      //
      // Legacy insert method
      // -------------------------------------------------
      const legacyInsert = function () {
        db.collection('t2_1').insertMany([{ a: 1 }, { a: 2 }], function (err, r) {
          expect(err).to.not.exist;
          expect(r).property('insertedCount').to.equal(2);

          bulkAPIInsert();
        });
      };

      //
      // Bulk api insert method
      // -------------------------------------------------
      const bulkAPIInsert = function () {
        const bulk = db.collection('t2_2').initializeOrderedBulkOp();
        bulk.insert({ a: 1 });
        bulk.insert({ a: 1 });
        bulk.execute(function (err) {
          expect(err).to.not.exist;

          insertOne();
        });
      };

      //
      // Insert one method
      // -------------------------------------------------
      const insertOne = function () {
        db.collection('t2_3').insertOne({ a: 1 }, { writeConcern: { w: 1 } }, function (err, r) {
          expect(err).to.not.exist;
          expect(r).property('insertedId').to.exist;
          insertMany();
        });
      };

      //
      // Insert many method
      // -------------------------------------------------
      const insertMany = function () {
        const docs = [{ a: 1 }, { a: 1 }];
        db.collection('t2_4').insertMany(docs, { writeConcern: { w: 1 } }, function (err, r) {
          expect(err).to.not.exist;
          expect(r).property('insertedCount').to.equal(2);

          // Ordered bulk unordered
          bulkWriteUnOrdered();
        });
      };

      //
      // Bulk write method unordered
      // -------------------------------------------------
      const bulkWriteUnOrdered = function () {
        db.collection('t2_5').insertMany([{ c: 1 }], { writeConcern: { w: 1 } }, function (err, r) {
          expect(err).to.not.exist;
          expect(r).property('insertedCount').to.equal(1);

          db.collection('t2_5').bulkWrite(
            [
              { insertOne: { document: { a: 1 } } },
              { insertOne: { document: { g: 1 } } },
              { insertOne: { document: { g: 2 } } },
              { updateOne: { filter: { a: 2 }, update: { $set: { a: 2 } }, upsert: true } },
              { updateMany: { filter: { a: 2 }, update: { $set: { a: 2 } }, upsert: true } },
              { deleteOne: { filter: { c: 1 } } },
              { deleteMany: { filter: { c: 1 } } }
            ],
            { ordered: false, writeConcern: { w: 1 } },
            function (err, r) {
              expect(err).to.not.exist;
              test.equal(3, r.insertedCount);
              test.equal(1, r.upsertedCount);
              test.equal(1, r.deletedCount);

              // Crud fields
              test.equal(3, r.insertedCount);
              test.equal(3, Object.keys(r.insertedIds).length);
              test.equal(1, r.matchedCount);
              test.equal(1, r.deletedCount);
              test.equal(1, r.upsertedCount);
              test.equal(1, Object.keys(r.upsertedIds).length);

              // Ordered bulk operation
              bulkWriteUnOrderedSpec();
            }
          );
        });
      };

      //
      // Bulk write method unordered
      // -------------------------------------------------
      const bulkWriteUnOrderedSpec = function () {
        db.collection('t2_6').insertMany(
          [{ c: 1 }, { c: 2 }, { c: 3 }],
          { writeConcern: { w: 1 } },
          function (err, r) {
            expect(err).to.not.exist;
            expect(r).property('insertedCount').to.equal(3);

            db.collection('t2_6').bulkWrite(
              [
                { insertOne: { document: { a: 1 } } },
                { updateOne: { filter: { a: 2 }, update: { $set: { a: 2 } }, upsert: true } },
                { updateMany: { filter: { a: 3 }, update: { $set: { a: 3 } }, upsert: true } },
                { deleteOne: { filter: { c: 1 } } },
                { deleteMany: { filter: { c: 2 } } },
                { replaceOne: { filter: { c: 3 }, replacement: { c: 4 }, upsert: true } }
              ],
              { ordered: false, writeConcern: { w: 1 } },
              function (err, r) {
                expect(err).to.not.exist;
                test.equal(1, r.insertedCount);
                test.equal(2, r.upsertedCount);
                test.equal(2, r.deletedCount);

                // Crud fields
                test.equal(1, r.insertedCount);
                test.equal(1, Object.keys(r.insertedIds).length);
                test.equal(1, r.matchedCount);
                test.equal(2, r.deletedCount);
                test.equal(2, r.upsertedCount);
                test.equal(2, Object.keys(r.upsertedIds).length);

                // Ordered bulk operation
                bulkWriteOrdered();
              }
            );
          }
        );
      };

      //
      // Bulk write method ordered
      // -------------------------------------------------
      const bulkWriteOrdered = function () {
        db.collection('t2_7').insertMany([{ c: 1 }], { writeConcern: { w: 1 } }, function (err, r) {
          expect(err).to.not.exist;
          expect(r).property('insertedCount').to.equal(1);

          db.collection('t2_7').bulkWrite(
            [
              { insertOne: { document: { a: 1 } } },
              { insertOne: { document: { g: 1 } } },
              { insertOne: { document: { g: 2 } } },
              { updateOne: { filter: { a: 2 }, update: { $set: { a: 2 } }, upsert: true } },
              { updateMany: { filter: { a: 2 }, update: { $set: { a: 2 } }, upsert: true } },
              { deleteOne: { filter: { c: 1 } } },
              { deleteMany: { filter: { c: 1 } } }
            ],
            { ordered: true, writeConcern: { w: 1 } },
            function (err, r) {
              expect(err).to.not.exist;
              test.equal(3, r.insertedCount);
              test.equal(1, r.upsertedCount);
              test.equal(1, r.deletedCount);

              // Crud fields
              test.equal(3, r.insertedCount);
              test.equal(3, Object.keys(r.insertedIds).length);
              test.equal(1, r.matchedCount);
              test.equal(1, r.deletedCount);
              test.equal(1, r.upsertedCount);
              test.equal(1, Object.keys(r.upsertedIds).length);

              bulkWriteOrderedCrudSpec();
            }
          );
        });
      };

      //
      // Bulk write method ordered
      // -------------------------------------------------
      const bulkWriteOrderedCrudSpec = function () {
        db.collection('t2_8').insertMany([{ c: 1 }], { writeConcern: { w: 1 } }, function (err, r) {
          expect(err).to.not.exist;
          expect(r).property('insertedCount').to.equal(1);

          db.collection('t2_8').bulkWrite(
            [
              { insertOne: { document: { a: 1 } } },
              { updateOne: { filter: { a: 2 }, update: { $set: { a: 2 } }, upsert: true } },
              { updateMany: { filter: { a: 2 }, update: { $set: { a: 2 } }, upsert: true } },
              { deleteOne: { filter: { c: 1 } } },
              { deleteMany: { filter: { c: 1 } } },
              { replaceOne: { filter: { c: 3 }, replacement: { c: 4 }, upsert: true } }
            ],
            { ordered: true, writeConcern: { w: 1 } },
            function (err, r) {
              // expect(err).to.not.exist;
              test.equal(1, r.insertedCount);
              test.equal(2, r.upsertedCount);
              test.equal(1, r.deletedCount);

              // Crud fields
              test.equal(1, r.insertedCount);
              test.equal(1, Object.keys(r.insertedIds).length);
              test.equal(1, r.matchedCount);
              test.equal(1, r.deletedCount);
              test.equal(2, r.upsertedCount);
              test.equal(2, Object.keys(r.upsertedIds).length);

              client.close(done);
            }
          );
        });
      };

      legacyInsert();
    });
  });

  it('should correctly execute update methods using crud api', {
    // Add a tag that our runner can trigger on
    // in this case we are setting that node needs to be higher than 0.10.X to run
    metadata: {
      requires: { topology: ['single', 'replicaset', 'sharded', 'ssl', 'heap', 'wiredtiger'] }
    },

    test: function (done) {
      client.connect(function (err, client) {
        const db = client.db();

        //
        // Legacy update method
        // -------------------------------------------------
        const legacyUpdate = function () {
          db.collection('t3_1').update(
            { a: 1 },
            { $set: { a: 2 } },
            { upsert: true },
            function (err, r) {
              expect(err).to.not.exist;
              expect(r).property('upsertedCount').to.equal(1);

              updateOne();
            }
          );
        };

        //
        // Update one method
        // -------------------------------------------------
        const updateOne = function () {
          db.collection('t3_2').insertMany(
            [{ c: 1 }],
            { writeConcern: { w: 1 } },
            function (err, r) {
              expect(err).to.not.exist;
              expect(r).property('insertedCount').to.equal(1);

              db.collection('t3_2').updateOne(
                { a: 1 },
                { $set: { a: 1 } },
                { upsert: true },
                function (err, r) {
                  expect(err).to.not.exist;
                  expect(r).property('upsertedCount').to.equal(1);
                  test.equal(0, r.matchedCount);
                  test.ok(r.upsertedId != null);

                  db.collection('t3_2').updateOne({ c: 1 }, { $set: { a: 1 } }, function (err, r) {
                    expect(err).to.not.exist;
                    expect(r).property('modifiedCount').to.equal(1);
                    test.equal(1, r.matchedCount);
                    test.ok(r.upsertedId == null);

                    replaceOne();
                  });
                }
              );
            }
          );
        };

        //
        // Replace one method
        // -------------------------------------------------
        const replaceOne = function () {
          db.collection('t3_3').replaceOne({ a: 1 }, { a: 2 }, { upsert: true }, function (err, r) {
            expect(err).to.not.exist;
            expect(r).property('upsertedCount').to.equal(1);
            test.equal(0, r.matchedCount);
            test.ok(r.upsertedId != null);

            db.collection('t3_3').replaceOne(
              { a: 2 },
              { a: 3 },
              { upsert: true },
              function (err, r) {
                expect(err).to.not.exist;
                expect(r).property('modifiedCount').to.equal(1);
                expect(r).property('upsertedCount').to.equal(0);
                expect(r).property('matchedCount').to.equal(1);

                updateMany();
              }
            );
          });
        };

        //
        // Update many method
        // -------------------------------------------------
        const updateMany = function () {
          db.collection('t3_4').insertMany(
            [{ a: 1 }, { a: 1 }],
            { writeConcern: { w: 1 } },
            function (err, r) {
              expect(err).to.not.exist;
              expect(r).property('insertedCount').to.equal(2);

              db.collection('t3_4').updateMany(
                { a: 1 },
                { $set: { a: 2 } },
                { upsert: true, writeConcern: { w: 1 } },
                function (err, r) {
                  expect(err).to.not.exist;
                  expect(r).property('modifiedCount').to.equal(2);
                  test.equal(2, r.matchedCount);
                  test.ok(r.upsertedId == null);

                  db.collection('t3_4').updateMany(
                    { c: 1 },
                    { $set: { d: 2 } },
                    { upsert: true, writeConcern: { w: 1 } },
                    function (err, r) {
                      expect(err).to.not.exist;
                      test.equal(0, r.matchedCount);
                      test.ok(r.upsertedId != null);

                      client.close(done);
                    }
                  );
                }
              );
            }
          );
        };

        legacyUpdate();
      });
    }
  });

  it('should correctly execute findAndModify methods using crud api', {
    // Add a tag that our runner can trigger on
    // in this case we are setting that node needs to be higher than 0.10.X to run
    metadata: {
      requires: { topology: ['single', 'replicaset', 'sharded', 'ssl', 'heap', 'wiredtiger'] }
    },

    test: function (done) {
      client.connect(function (err, client) {
        const db = client.db();

        //
        // findOneAndRemove method
        // -------------------------------------------------
        const findOneAndRemove = function () {
          db.collection('t5_1').insertMany(
            [{ a: 1, b: 1 }],
            { writeConcern: { w: 1 } },
            function (err, r) {
              expect(err).to.not.exist;
              expect(r).property('insertedCount').to.equal(1);

              db.collection('t5_1').findOneAndDelete(
                { a: 1 },
                { projection: { b: 1 }, sort: { a: 1 } },
                function (err, r) {
                  expect(err).to.not.exist;
                  test.equal(1, r.lastErrorObject.n);
                  test.equal(1, r.value.b);

                  findOneAndReplace();
                }
              );
            }
          );
        };

        //
        // findOneAndRemove method
        // -------------------------------------------------
        const findOneAndReplace = function () {
          db.collection('t5_2').insertMany(
            [{ a: 1, b: 1 }],
            { writeConcern: { w: 1 } },
            function (err, r) {
              expect(err).to.not.exist;
              expect(r).property('insertedCount').to.equal(1);

              db.collection('t5_2').findOneAndReplace(
                { a: 1 },
                { c: 1, b: 1 },
                {
                  projection: { b: 1, c: 1 },
                  sort: { a: 1 },
                  returnDocument: ReturnDocument.AFTER,
                  upsert: true
                },
                function (err, r) {
                  expect(err).to.not.exist;
                  test.equal(1, r.lastErrorObject.n);
                  test.equal(1, r.value.b);
                  test.equal(1, r.value.c);

                  findOneAndUpdate();
                }
              );
            }
          );
        };

        //
        // findOneAndRemove method
        // -------------------------------------------------
        const findOneAndUpdate = function () {
          db.collection('t5_3').insertMany(
            [{ a: 1, b: 1 }],
            { writeConcern: { w: 1 } },
            function (err, r) {
              expect(err).to.not.exist;
              expect(r).property('insertedCount').to.equal(1);

              db.collection('t5_3').findOneAndUpdate(
                { a: 1 },
                { $set: { d: 1 } },
                {
                  projection: { b: 1, d: 1 },
                  sort: { a: 1 },
                  returnDocument: ReturnDocument.AFTER,
                  upsert: true
                },
                function (err, r) {
                  expect(err).to.not.exist;
                  test.equal(1, r.lastErrorObject.n);
                  test.equal(1, r.value.b);
                  test.equal(1, r.value.d);

                  client.close(done);
                }
              );
            }
          );
        };

        findOneAndRemove();
      });
    }
  });

  it('should correctly execute removeMany with no selector', {
    // Add a tag that our runner can trigger on
    // in this case we are setting that node needs to be higher than 0.10.X to run
    metadata: {
      requires: { topology: ['single', 'replicaset', 'sharded', 'ssl', 'heap', 'wiredtiger'] }
    },

    test: function (done) {
      client.connect(function (err, client) {
        const db = client.db();
        expect(err).to.not.exist;

        // Delete all items with no selector
        db.collection('t6_1').deleteMany({}, function (err) {
          expect(err).to.not.exist;

          client.close(done);
        });
      });
    }
  });

  it('should correctly execute crud operations with w:0', {
    // Add a tag that our runner can trigger on
    // in this case we are setting that node needs to be higher than 0.10.X to run
    metadata: {
      requires: { topology: ['single', 'replicaset', 'sharded', 'ssl', 'heap', 'wiredtiger'] }
    },

    test: function (done) {
      client.connect(function (err, client) {
        const db = client.db();
        expect(err).to.not.exist;

        const col = db.collection('shouldCorrectlyExecuteInsertOneWithW0');
        col.insertOne({ a: 1 }, { writeConcern: { w: 0 } }, function (err, result) {
          expect(err).to.not.exist;
          expect(result).property('acknowledged').to.be.false;
          expect(result).property('insertedId').to.exist;

          col.insertMany([{ a: 1 }], { writeConcern: { w: 0 } }, function (err, result) {
            expect(err).to.not.exist;
            expect(result).to.exist;

            col.updateOne(
              { a: 1 },
              { $set: { b: 1 } },
              { writeConcern: { w: 0 } },
              function (err, result) {
                expect(err).to.not.exist;
                expect(result).to.exist;

                col.updateMany(
                  { a: 1 },
                  { $set: { b: 1 } },
                  { writeConcern: { w: 0 } },
                  function (err, result) {
                    expect(err).to.not.exist;
                    expect(result).to.exist;

                    col.deleteOne({ a: 1 }, { writeConcern: { w: 0 } }, function (err, result) {
                      expect(err).to.not.exist;
                      expect(result).to.exist;

                      col.deleteMany({ a: 1 }, { writeConcern: { w: 0 } }, function (err, result) {
                        expect(err).to.not.exist;
                        expect(result).to.exist;

                        client.close(done);
                      });
                    });
                  }
                );
              }
            );
          });
        });
      });
    }
  });

  it('should correctly execute updateOne operations with w:0 and upsert', {
    // Add a tag that our runner can trigger on
    // in this case we are setting that node needs to be higher than 0.10.X to run
    metadata: {
      requires: { topology: ['single', 'replicaset', 'sharded', 'ssl', 'heap', 'wiredtiger'] }
    },

    test: function (done) {
      client.connect(function (err, client) {
        const db = client.db();
        expect(err).to.not.exist;

        db.collection('try').updateOne(
          { _id: 1 },
          { $set: { x: 1 } },
          { upsert: true, writeConcern: { w: 0 } },
          function (err, r) {
            expect(err).to.not.exist;
            test.ok(r != null);

            client.close(done);
          }
        );
      });
    }
  });

  it('should correctly execute crud operations using w:0', {
    // Add a tag that our runner can trigger on
    // in this case we are setting that node needs to be higher than 0.10.X to run
    metadata: {
      requires: { topology: ['single', 'replicaset', 'sharded', 'ssl', 'heap', 'wiredtiger'] }
    },

    test: function (done) {
      client.connect(function (err, client) {
        const db = client.db();
        expect(err).to.not.exist;

        const collection = db.collection('w0crudoperations');
        collection.insertOne({}, function (err) {
          expect(err).to.not.exist;
          client.close(done);
        });

        // collection.insertOne({a:1});
        // collection.insertMany([{b:1}]);
        // collection.updateOne({c:1}, {$set:{a:1}}, {upsert:true});

        // db.collection('try').updateOne({_id:1}, {$set:{x:1}}, {upsert:true, w:0}, function(err, r) {
        //   expect(err).to.not.exist;
        //   test.ok(r != null);

        //   client.close();
        //   done();
        // });
      });
    }
  });

  it('should correctly throw error on illegal callback when unordered bulkWrite encounters error', {
    // Add a tag that our runner can trigger on
    // in this case we are setting that node needs to be higher than 0.10.X to run
    metadata: {
      requires: { topology: ['single', 'replicaset', 'sharded', 'ssl', 'heap', 'wiredtiger'] }
    },

    test: async function () {
      const ops = [];
      // Create a set of operations that go over the 1000 limit causing two messages
      let i = 0;
      for (; i < 1005; i++) {
        ops.push({ insertOne: { _id: i, a: i } });
      }

      ops.push({ insertOne: { _id: 0, a: i } });

      const db = client.db();

      const error = await db
        .collection('t20_1')
        .bulkWrite(ops, { ordered: false, writeConcern: { w: 1 } })
        .catch(error => error);

      expect(error).to.be.instanceOf(MongoError);
    }
  });

  it('should correctly throw error on illegal callback when ordered bulkWrite encounters error', {
    // Add a tag that our runner can trigger on
    // in this case we are setting that node needs to be higher than 0.10.X to run
    metadata: {
      requires: { topology: ['single', 'replicaset', 'sharded', 'ssl', 'heap', 'wiredtiger'] }
    },

    test: function (done) {
      const ops = [];
      // Create a set of operations that go over the 1000 limit causing two messages
      let i = 0;
      for (; i < 1005; i++) {
        ops.push({ insertOne: { _id: i, a: i } });
      }

      ops.push({ insertOne: { _id: 0, a: i } });

      client.connect(function (err, client) {
        const db = client.db();
        expect(err).to.not.exist;

        db.collection('t20_1').bulkWrite(
          ops,
          { ordered: true, writeConcern: { w: 1 } },
          function (err) {
            test.ok(err !== null);
            client.close(done);
          }
        );
      });
    }
  });
});
