package com.nexuschain.balance.grpc;

import io.grpc.Server;
import io.grpc.ServerBuilder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.SmartLifecycle;
import org.springframework.stereotype.Component;

import java.io.IOException;

@Component
public class GrpcServerRunner implements SmartLifecycle {

    @Autowired
    private BalanceGrpcController balanceGrpcController;

    @Value("${grpc.server.port:50051}")
    private int port;

    private Server server;
    private boolean isRunning = false;

    @Override
    public void start() {
        try {
            server = ServerBuilder.forPort(port)
                    .addService(balanceGrpcController)
                    .build();
            server.start();
            isRunning = true;
            System.out.println("📶 gRPC Server started, listening on port " + port);
            
            // Daemon thread to wait for termination in background so it doesn't block Spring startup
            Thread grpcThread = new Thread(() -> {
                try {
                    server.awaitTermination();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });
            grpcThread.setDaemon(true);
            grpcThread.start();

        } catch (IOException e) {
            throw new RuntimeException("Could not start gRPC server", e);
        }
    }

    @Override
    public void stop() {
        if (server != null) {
            server.shutdown();
            isRunning = false;
            System.out.println("📶 gRPC Server stopped.");
        }
    }

    @Override
    public boolean isRunning() {
        return isRunning;
    }

    @Override
    public int getPhase() {
        return Integer.MAX_VALUE; // Start late in the lifecycle
    }
}
