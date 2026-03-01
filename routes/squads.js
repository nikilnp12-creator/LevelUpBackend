const express = require('express');
const { protect } = require('../middleware/auth');
const {
  getMySquads, searchSquads, createSquad, joinSquad, requestJoin,
  getSquad, getInviteCode, leaveSquad, getJoinRequests, acceptRequest, rejectRequest,
} = require('../controllers/squadController');
const { getSquadFeedById } = require('../controllers/postController');

const router = express.Router();
router.use(protect);

router.get('/my',     getMySquads);
router.get('/search', searchSquads);
router.post('/',      createSquad);
router.post('/join',  joinSquad);

router.get('/:id',                                  getSquad);
router.get('/:id/feed',                             getSquadFeedById);
router.get('/:id/invite',                           getInviteCode);
router.delete('/:id/leave',                         leaveSquad);
router.post('/:id/request',                         requestJoin);
router.get('/:id/requests',                         getJoinRequests);
router.post('/:id/requests/:requestId/accept',      acceptRequest);
router.post('/:id/requests/:requestId/reject',      rejectRequest);

module.exports = router;
