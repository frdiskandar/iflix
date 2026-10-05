package main

import (
	"log"
	"net/http"
	"os"

	"stream-platform/backend/internal/cache"
	"stream-platform/backend/internal/cors"
	"stream-platform/backend/internal/health"
	"stream-platform/backend/internal/rooms"
	"stream-platform/backend/internal/upstream"
)

func main() {
	c := cache.NewFromEnv()
	defer c.Close()
	log.Printf("cache backend: %s", c.Backend())

	hub := rooms.NewHub(nil)
	broker := rooms.NewBrokerFromEnv(hub.Deliver)
	hub.SetBroker(broker)
	defer broker.Close()
	log.Printf("rooms broker: %s", broker.Backend())

	mux := http.NewServeMux()
	health.RegisterRoutes(mux)
	upstream.RegisterRoutes(mux, c)
	rooms.NewServer(hub).RegisterRoutes(mux)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("listening on :%s", port)
	if err := http.ListenAndServe(":"+port, cors.Middleware(mux)); err != nil {
		log.Fatal(err)
	}
}
