package rooms

import (
	"errors"
	"log"
	"os"
	"strings"
	"sync"

	amqp "github.com/rabbitmq/amqp091-go"
)

var errTooManyRooms = errors.New("too many rooms")

// Broker fans room broadcasts out to other backend instances.
// Implementations must be safe for concurrent use.
type Broker interface {
	// Publish sends one already-marshalled broadcast for code.
	Publish(code string, payload []byte) error
	// Backend reports "local" or "rabbitmq" for boot logs.
	Backend() string
	// Close releases broker resources.
	Close()
}

// LocalBroker is the no-op fallback: single instance, nothing to fan out.
type LocalBroker struct{}

func (LocalBroker) Publish(string, []byte) error { return nil }
func (LocalBroker) Backend() string              { return "local" }
func (LocalBroker) Close()                       {}

// RabbitBroker publishes room events on a topic exchange ("rooms",
// key room.<CODE>) so every instance receives every room's events and
// dispatches the ones it hosts. If the URL is unset or the dial fails,
// the caller falls back to LocalBroker — boot never fails.
type RabbitBroker struct {
	conn     *amqp.Connection
	ch       *amqp.Channel
	mu       sync.Mutex
	exchange string
}

const roomsExchange = "rooms"

// NewBrokerFromEnv returns a RabbitMQ broker when RABBITMQ_URL is set
// and reachable; otherwise a LocalBroker. It never returns nil and
// never fails boot: connection errors degrade to local mode with a log.
func NewBrokerFromEnv(onMessage func(code string, payload []byte)) Broker {
	rawURL := strings.TrimSpace(os.Getenv("RABBITMQ_URL"))
	if rawURL == "" {
		return LocalBroker{}
	}
	conn, err := amqp.Dial(rawURL)
	if err != nil {
		log.Printf("rooms: rabbitmq unreachable, running local: %v", err)
		return LocalBroker{}
	}
	ch, err := conn.Channel()
	if err != nil {
		log.Printf("rooms: rabbitmq channel failed, running local: %v", err)
		_ = conn.Close()
		return LocalBroker{}
	}
	if err := ch.ExchangeDeclare(roomsExchange, "topic", true, false, false, false, nil); err != nil {
		log.Printf("rooms: rabbitmq exchange failed, running local: %v", err)
		_ = ch.Close()
		_ = conn.Close()
		return LocalBroker{}
	}
	b := &RabbitBroker{conn: conn, ch: ch, exchange: roomsExchange}
	if err := b.consume(onMessage); err != nil {
		log.Printf("rooms: rabbitmq consume failed, running local: %v", err)
		b.Close()
		return LocalBroker{}
	}
	log.Printf("rooms: broker backend=rabbitmq")
	return b
}

func (b *RabbitBroker) Backend() string { return "rabbitmq" }

func (b *RabbitBroker) Publish(code string, payload []byte) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.ch == nil {
		return errors.New("rabbitmq channel closed")
	}
	return b.ch.Publish(b.exchange, "room."+code, false, false, amqp.Publishing{
		ContentType: "application/json",
		Body:        payload,
	})
}

func (b *RabbitBroker) consume(onMessage func(code string, payload []byte)) error {
	q, err := b.ch.QueueDeclare("", false, true, true, false, nil)
	if err != nil {
		return err
	}
	if err := b.ch.QueueBind(q.Name, "room.*", b.exchange, false, nil); err != nil {
		return err
	}
	msgs, err := b.ch.Consume(q.Name, "", true, true, false, false, nil)
	if err != nil {
		return err
	}
	go func() {
		for m := range msgs {
			key := m.RoutingKey // room.<CODE>
			code := strings.TrimPrefix(key, "room.")
			if code == "" || onMessage == nil {
				continue
			}
			onMessage(code, m.Body)
		}
	}()
	return nil
}

func (b *RabbitBroker) Close() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.ch != nil {
		_ = b.ch.Close()
		b.ch = nil
	}
	if b.conn != nil {
		_ = b.conn.Close()
		b.conn = nil
	}
}
