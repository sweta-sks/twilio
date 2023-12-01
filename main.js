require("dotenv").config();
const fs = require("fs");
const https = require("https");
const { v4: uuidv4 } = require("uuid");
const AccessToken = require("twilio").jwt.AccessToken;
const VideoGrant = AccessToken.VideoGrant;
const express = require("express");
const app = express();
const port = 5000;

// use the Express JSON middleware
app.use(express.json());
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile("public/index.html");
});

// create the twilioClient
const twilioClient = require("twilio")(
  process.env.TWILIO_API_KEY_SID,
  process.env.TWILIO_API_KEY_SECRET,
  { accountSid: process.env.TWILIO_ACCOUNT_SID }
);

const findOrCreateRoom = async (roomName) => {
  try {
    // see if the room exists already. If it doesn't, this will throw
    // error 20404.

    await twilioClient.video.v1.rooms(roomName).fetch();
  } catch (error) {
    // the room was not found, so create it
    if (error.code == 20404) {
      const roomCreated = await twilioClient.video.v1.rooms.create({
        uniqueName: roomName,
        type: "group",
        //recordParticipantsOnConnect: true,
      });

      console.log(`Created room ${roomCreated.sid}`);
    } else {
      // let other errors bubble up
      throw error;
    }
  }
};

const startRecording = async (sid) => {
  try {
    // find or create the room

    // start recording the room
    console.log(`sid: ${sid}`);
    const room = await twilioClient.video.v1.rooms(sid).recordingRules.update({
      rules: [
        {
          type: "include",
          all: true,
        },
      ],
    });
    room = await twilioClient.video.v1.recordings(sid).create({
      type: "audio",
      containerFormat: "mp4",
      audioChannels: "mono",
      codec: "aac",
    });
    console.log(room);

    return room;
  } catch (error) {
    console.log(error);
    return error;
  }
};

const getAccessToken = (roomName) => {
  // create an access token
  const token = new AccessToken(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_API_KEY_SID,
    process.env.TWILIO_API_KEY_SECRET,
    // generate a random unique identity for this participant
    { identity: uuidv4() }
  );
  // create a video grant for this specific room
  const videoGrant = new VideoGrant({
    room: roomName,
  });

  // add the video grant
  token.addGrant(videoGrant);
  // serialize the token and return it
  return token.toJwt();
};

const getRoomsAndCompositions = async () => {
  let rooms = [];
  let compositions = [];

  try {
    // Get a list of recent video rooms. In this case, the 10 most recent completed rooms
    rooms = await twilioClient.video.v1.rooms.list({
      status: "completed",
      limit: 10,
    });
    console.log("getting recordings");

    // Get a list of recordings
    let recordings = await twilioClient.video.v1.recordings.list();
    console.log(`recordings: ${recordings}`);
    // Create a list of only the room sids that have associated recordings
    let roomSidsWithRecordings = recordings.map((recording) => {
      return recording.groupingSids.room_sid;
    });
    console.log(`roomSidsWithRecordings: ${roomSidsWithRecordings}`);
    // Filter out the duplicates
    const setOfRoomSidsWithRecordings = [...new Set(roomSidsWithRecordings)];

    // Get the full details of the rooms with recordings
    const roomsWithRecordings = rooms.filter((room) => {
      if (setOfRoomSidsWithRecordings.includes(room.sid)) {
        return room;
      }
    });
    console.log(`roomsWithRecordings: ${roomsWithRecordings}`);
    // Get a list of completed compositions
    compositions = await twilioClient.video.v1.compositions.list({
      status: "completed",
    });
    console.log(`compositions: ${compositions.map((comp) => comp.roomSid)}`);
    let videoRooms = [];

    // Match up any completed compositions with their associated rooms
    roomsWithRecordings.forEach((room) => {
      const roomCompositions = compositions.filter(
        (composition) => composition.roomSid === room.sid
      );

      console.log(`roomCompositions: ${roomCompositions}`);
      let VideoRoom = {
        sid: room.sid,
        name: room.uniqueName,
        duration: room.duration,
        compositions: roomCompositions,
      };

      videoRooms.push(VideoRoom);
    });
    console.log(videoRooms);
    // Return this list of video rooms and associated compositions
    return videoRooms;
  } catch (error) {
    console.log(error);
    return error;
  }
};

app.post("/join-room", async (req, res) => {
  // return 400 if the request has an empty body or no roomName
  if (!req.body || !req.body.roomName) {
    return res.status(400).send("Must include roomName argument.");
  }
  const roomName = req.body.roomName;
  // find or create a room with the given roomName
  findOrCreateRoom(roomName);
  // generate an Access Token for a participant in this room
  const token = getAccessToken(roomName);
  res.send({
    token: token,
  });
});

app.get("/list", async (req, res) => {
  const rooms = await twilioClient.video.v1.rooms.list({ limit: 20 });
  res.json(rooms);
});
app.post("/callbacks", (req, res) => {
  const status = req.body.StatusCallbackEvent;
  res.send(status);
});

app.get("/sms", async (req, res) => {
  const res = await twilioClient.messages.create({
    body: "Hello from Node",
    from: "+12056276957",
    to: "+919971859600",
  });
});

app.get("/record", async (req, res) => {
  const recordings = await twilioClient.video.v1.recordings.list();
  const count = recordings.length;
  console.log(recordings.map((rec) => rec.sid));
  res.json({
    count: count,
    recordings: recordings,
  });
});
app.get("/delete/record/:sid", async (req, res) => {
  const recording = await twilioClient.video.v1
    .recordings(req.params.sid)
    .remove();
  console.log(recording);
  res.send(recording);
});
app.get("/record/:roomSid", async (req, res) => {
  // const room = await twilioClient.video.v1.recordings.list();

  const recordRoom = await twilioClient.video.v1
    .rooms(req.params.roomSid)
    .recordings.list();
  const room_sid = recordRoom.map((rec) => rec.sid);
  console.log(recordRoom);
  console.log(room_sid);

  const compList = await twilioClient.video.v1.compositions.list();
  console.log(compList);

  res.send(recordRoom);
});

app.get("/list/:sid", async (req, res) => {
  const room = await twilioClient.video.v1.rooms(req.params.sid).fetch();
  console.log(room);
  res.send(room);
});
app.post("/start-recording", async (req, res) => {
  // return 400 if the request has an empty body or no roomName
  if (!req.body || !req.body.roomName) {
    return res.status(400).send("Must include roomName argument.");
  }
  const roomSid = req.body.roomName;
  // find or create a room with the given roomName
  console.log(roomSid);
  await startRecording(roomSid);
  // generate an Access Token for a participant in this room

  res.send({
    message: `Started recording room ${roomSid}`,
  });
});
app.get("/roomComposition", async (req, res, next) => {
  try {
    let rooms = await getRoomsAndCompositions();
    res.send(rooms);
    // return res.render("room", { rooms });
  } catch (error) {
    return res.status(400).send({
      message: `Unable to list rooms`,
      error,
    });
  }
});

app.get("/complete/:sid", async (req, res) => {
  const roomSid = req.params.sid;
  const room = await twilioClient.video.v1.rooms(roomSid).update({
    status: "completed",
  });
  console.log(room);
  res.send(room);
});

app.get("/composition", async (req, res) => {
  const compositions = await twilioClient.video.v1.compositions.list();
  console.log(compositions.map((comp) => comp.sid));
  res.json(compositions);
});

app.get("/composition/:sid", async (req, res) => {
  if (!req.params.sid) {
    return res.status(400).send({
      message: `No value provided for roomSid`,
    });
  }
  const roomSid = req.params.sid;
  const recordings = await twilioClient.video.v1.recordings.list({
    groupingSid: [roomSid],
  });
  console.log(recordings);
  let createComposition = await twilioClient.video.v1.compositions.create({
    roomSid: roomSid,
    audioSources: "*",
    videoLayout: {
      grid: {
        video_sources: ["*"],
      },
    },
    statusCallback: "http://localhost:5000/callbacks",
    format: "mp4",
  });
  console.log(createComposition);
  res.send(createComposition);
});
app.get("/delete/composition/:sid", async (req, res) => {
  const composition = await twilioClient.video.v1
    .compositions(req.params.sid)
    .remove();
  console.log(composition);
  res.send(composition);
});

// app.get("/download/:compSid", async (req, res) => {
//   const compositionSid = req.params.compSid;
//   const composition = await twilioClient.video.v1
//     .compositions(compositionSid)
//     .fetch();
//   console.log(composition);
//   const uri = composition.links.media;
//   console.log(uri);
//   const response = await fetch(uri);
//   console.log(response);
//   const buffer = await response.buffer();
//   const path = `./${compositionSid}.mp4`;
//   fs.writeFile(path, buffer, () =>
//     console.log("finished downloading!")
//   );
//   res.send(response);
// });

// Start the Express server

//const fetch = require("node-fetch");

app.get("/download/:compSid", async (req, res) => {
  const compositionSid = req.params.compSid;
  const composition = await twilioClient.video.v1
    .compositions(compositionSid)
    .fetch();
  console.log(composition);
  const uri = composition.links.media;
  console.log(uri);

  try {
    const file = fs.createWriteStream(process.cwd() + "/saved-file.doc");

    let compResponse = await twilioClient.request({
      method: "GET",
      uri: uri,
    });
    console.log(compResponse);
    const firstResponse = await fetch(uri);
    const response = await fetch(compResponse.body.redirect_to);
    console.log(response);
    console.log(firstResponse);

    return res.status(200).send({ url: compResponse.body.redirect_to });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error fetching data");
  }
});

app.listen(port, () => {
  console.log(`Express server running on port ${port}`);
});
