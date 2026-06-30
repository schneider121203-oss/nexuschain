package main

import (
	"fmt"
	"math/rand"
	"sync"
	"time"
)

type Role string

const (
	Follower  Role = "FOLLOWER"
	Candidate Role = "CANDIDATE"
	Leader    Role = "LEADER"
)

type RequestVoteArgs struct {
	Term        int
	CandidateID int
}

type RequestVoteReply struct {
	Term        int
	VoteGranted bool
}

type AppendEntriesArgs struct {
	Term     int
	LeaderID int
}

type AppendEntriesReply struct {
	Term    int
	Success bool
}

type Message struct {
	From    int
	To      int
	Payload interface{}
}

type RaftNode struct {
	mu        sync.Mutex
	id        int
	role      Role
	term      int
	votedFor  int
	heartbeat chan bool
	inbox     chan Message
	alive     bool
}

var (
	nodes   = make(map[int]*RaftNode)
	network = make(chan Message, 100)
)

func NewRaftNode(id int) *RaftNode {
	return &RaftNode{
		id:        id,
		role:      Follower,
		term:      0,
		votedFor:  -1,
		heartbeat: make(chan bool, 10),
		inbox:     make(chan Message, 100),
		alive:     true,
	}
}

func (n *RaftNode) log(format string, args ...interface{}) {
	prefix := fmt.Sprintf("[%s Node %d Term %d]", n.role, n.id, n.term)
	fmt.Printf("%-32s %s\n", prefix, fmt.Sprintf(format, args...))
}

func (n *RaftNode) run() {
	for {
		n.mu.Lock()
		if !n.alive {
			n.mu.Unlock()
			time.Sleep(50 * time.Millisecond)
			continue
		}
		role := n.role
		n.mu.Unlock()

		switch role {
		case Follower:
			n.runFollower()
		case Candidate:
			n.runCandidate()
		case Leader:
			n.runLeader()
		}
	}
}

func (n *RaftNode) runFollower() {
	// Randomized election timeout: 2000 to 3500 ms (slower for clear console visualization)
	timeout := time.Duration(2000+rand.Intn(1500)) * time.Millisecond
	timer := time.NewTimer(timeout)
	defer timer.Stop()

	for {
		n.mu.Lock()
		if n.role != Follower || !n.alive {
			n.mu.Unlock()
			return
		}
		n.mu.Unlock()

		select {
		case <-timer.C:
			n.mu.Lock()
			n.log("⏰ Election timeout expired! Starting election...")
			n.role = Candidate
			n.mu.Unlock()
			return
		case <-n.heartbeat:
			// Heartbeat received, reset timer
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			timer.Reset(time.Duration(2000+rand.Intn(1500)) * time.Millisecond)
		case msg := <-n.inbox:
			n.handleMessage(msg)
		}
	}
}

func (n *RaftNode) runCandidate() {
	n.mu.Lock()
	n.term++
	n.votedFor = n.id
	n.log("🗳️ Initiating campaign for leader election")
	n.mu.Unlock()

	// Request votes from everyone
	for _, other := range nodes {
		if other.id != n.id {
			send(n.id, other.id, RequestVoteArgs{Term: n.term, CandidateID: n.id})
		}
	}

	votes := 1
	timeout := time.Duration(1500+rand.Intn(1000)) * time.Millisecond
	timer := time.NewTimer(timeout)
	defer timer.Stop()

	for {
		n.mu.Lock()
		if n.role != Candidate || !n.alive {
			n.mu.Unlock()
			return
		}
		n.mu.Unlock()

		select {
		case <-timer.C:
			n.mu.Lock()
			n.log("⏰ Campaign term expired without consensus. Re-running candidate loop...")
			n.mu.Unlock()
			return
		case msg := <-n.inbox:
			switch reply := msg.Payload.(type) {
			case RequestVoteReply:
				n.mu.Lock()
				if reply.Term == n.term && reply.VoteGranted {
					votes++
					n.log("👍 Received vote from Node %d. Total votes: %d/%d", msg.From, votes, len(nodes))
					if votes > len(nodes)/2 {
						n.log("👑 Consensus achieved! Ascending to LEADER")
						n.role = Leader
						n.mu.Unlock()
						return
					}
				} else if reply.Term > n.term {
					n.role = Follower
					n.term = reply.Term
					n.votedFor = -1
					n.mu.Unlock()
					return
				}
				n.mu.Unlock()
			default:
				n.handleMessage(msg)
			}
		}
	}
}

func (n *RaftNode) runLeader() {
	ticker := time.NewTicker(800 * time.Millisecond)
	defer ticker.Stop()

	for {
		n.mu.Lock()
		if n.role != Leader || !n.alive {
			n.mu.Unlock()
			return
		}
		n.mu.Unlock()

		select {
		case <-ticker.C:
			// Send heartbeats
			for _, other := range nodes {
				if other.id != n.id {
					send(n.id, other.id, AppendEntriesArgs{Term: n.term, LeaderID: n.id})
				}
			}
		case msg := <-n.inbox:
			n.handleMessage(msg)
		}
	}
}

func (n *RaftNode) handleMessage(msg Message) {
	n.mu.Lock()
	defer n.mu.Unlock()

	if !n.alive {
		return
	}

	switch req := msg.Payload.(type) {
	case RequestVoteArgs:
		if req.Term > n.term {
			n.term = req.Term
			n.role = Follower
			n.votedFor = -1
		}

		granted := false
		if req.Term == n.term && (n.votedFor == -1 || n.votedFor == req.CandidateID) {
			n.votedFor = req.CandidateID
			granted = true
			n.log("🗳️ Voted for Candidate Node %d", req.CandidateID)
		}
		send(n.id, msg.From, RequestVoteReply{Term: n.term, VoteGranted: granted})

	case RequestVoteReply:
		if req.Term > n.term {
			n.term = req.Term
			n.role = Follower
			n.votedFor = -1
		}

	case AppendEntriesArgs:
		if req.Term >= n.term {
			if req.Term > n.term {
				n.term = req.Term
			}
			n.role = Follower
			n.votedFor = -1
			// Reset election timer
			select {
			case n.heartbeat <- true:
			default:
			}
			send(n.id, msg.From, AppendEntriesReply{Term: n.term, Success: true})
		} else {
			send(n.id, msg.From, AppendEntriesReply{Term: n.term, Success: false})
		}

	case AppendEntriesReply:
		if req.Term > n.term {
			n.term = req.Term
			n.role = Follower
			n.votedFor = -1
		}
	}
}

func send(from, to int, payload interface{}) {
	network <- Message{From: from, To: to, Payload: payload}
}

func routeNetwork() {
	for msg := range network {
		destNode, ok := nodes[msg.To]
		if ok {
			destNode.mu.Lock()
			alive := destNode.alive
			destNode.mu.Unlock()
			if alive {
				destNode.inbox <- msg
			}
		}
	}
}

func main() {
	rand.Seed(time.Now().UnixNano())

	fmt.Println("🚀 Initializing 3-Node Raft Consensus Network...")
	fmt.Println("-----------------------------------------------------------------")

	// Spawn nodes
	for i := 1; i <= 3; i++ {
		nodes[i] = NewRaftNode(i)
		go nodes[i].run()
	}

	// Route network messages in background
	go routeNetwork()

	// Let the network run for a bit to establish a leader
	time.Sleep(5 * time.Second)

	// Simulate Leader Failure
	for {
		var leader *RaftNode
		for _, n := range nodes {
			n.mu.Lock()
			if n.role == Leader && n.alive {
				leader = n
			}
			n.mu.Unlock()
		}

		if leader != nil {
			fmt.Println("------------- ⚠️ SIMULATING LEADER FAILURE ⚠️ -------------")
			leader.mu.Lock()
			leader.alive = false
			leader.role = Follower // Step down immediately to trigger re-election
			leader.log("❌ Node CRASHED/PAUSED")
			leader.mu.Unlock()

			// Wait for followers to detect leader failure and elect a new leader
			time.Sleep(8 * time.Second)

			fmt.Printf("------------- 🔄 REBOOTING CRASHED NODE %d ------------- \n", leader.id)
			leader.mu.Lock()
			leader.alive = true
			leader.log("🔌 Node REBOOTED")
			leader.mu.Unlock()

			// Let the cluster stabilize before next simulation iteration
			time.Sleep(8 * time.Second)
		} else {
			time.Sleep(1 * time.Second)
		}
	}
}
