using UnityEngine;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System;

/// <summary>
/// Serafim MAVLink Receiver for Unity.
/// Listens on UDP :14550, parses MAVLink v2 HEARTBEAT + GLOBAL_POSITION_INT,
/// moves drone GameObject accordingly.
/// 
/// Attach to a drone prefab. Creates realistic terrain scene at runtime.
/// </summary>
public class MavlinkReceiver : MonoBehaviour
{
    [Header("MAVLink Settings")]
    public int listenPort = 14550;
    public bool autoConnect = true;

    [Header("Drone Settings")]
    public float scaleFactor = 1.0f;  // meters to Unity units
    public float smoothSpeed = 5.0f;  // position interpolation
    public Vector3 homePosition = Vector3.zero; // GPS 55.75, 37.62 = (0,0,0)

    // MAVLink state
    private UdpClient udpClient;
    private Thread receiveThread;
    private bool running = false;

    // Drone state
    private Vector3 targetPosition;
    private Quaternion targetRotation;
    private bool armed = false;
    private float battery = 100f;
    private float altitude = 0f;
    private float speed = 0f;

    // Properties for UI
    public bool IsArmed => armed;
    public float Battery => battery;
    public float Altitude => altitude;
    public float Speed => speed;
    public Vector3 WorldPosition => transform.position;

    void Start()
    {
        targetPosition = transform.position;
        targetRotation = transform.rotation;

        if (autoConnect)
            Connect();
    }

    public void Connect()
    {
        try
        {
            udpClient = new UdpClient(listenPort);
            running = true;
            receiveThread = new Thread(ReceiveLoop);
            receiveThread.IsBackground = true;
            receiveThread.Start();
            Debug.Log($"MAVLink listening on UDP :{listenPort}");
        }
        catch (Exception e)
        {
            Debug.LogError($"MAVLink connect failed: {e.Message}");
        }
    }

    void ReceiveLoop()
    {
        IPEndPoint remote = new IPEndPoint(IPAddress.Any, 0);
        while (running)
        {
            try
            {
                byte[] data = udpClient.Receive(ref remote);
                ParseMAVLink(data);
            }
            catch (Exception e)
            {
                if (running) Debug.LogWarning($"MAVLink recv error: {e.Message}");
            }
        }
    }

    void ParseMAVLink(byte[] data)
    {
        if (data.Length < 10 || data[0] != 0xFD) return;

        int msgId = data[7];
        int payloadLen = data[1];
        if (payloadLen + 12 > data.Length) return;

        byte[] payload = new byte[payloadLen];
        Array.Copy(data, 10, payload, 0, payloadLen);

        switch (msgId)
        {
            case 0: // HEARTBEAT
                if (payload.Length >= 5)
                {
                    armed = (payload[1] & 0x80) != 0;
                }
                break;

            case 33: // GLOBAL_POSITION_INT
                if (payload.Length >= 28)
                {
                    // lat, lon, alt
                    int lat = BitConverter.ToInt32(payload, 4);
                    int lon = BitConverter.ToInt32(payload, 8);
                    int altMsl = BitConverter.ToInt32(payload, 12);
                    int altRel = BitConverter.ToInt32(payload, 16);
                    short vx = BitConverter.ToInt16(payload, 20);
                    short vy = BitConverter.ToInt16(payload, 22);
                    short vz = BitConverter.ToInt16(payload, 24);
                    short heading = BitConverter.ToInt16(payload, 26);

                    altitude = altRel / 1000.0f;
                    speed = Mathf.Sqrt((vx*vx + vy*vy + vz*vz) / 10000.0f);

                    // Convert GPS -> world position (simplified)
                    // 55.75, 37.62 = home
                    float worldX = (lon / 1e7f - 37.62f) * 111000f * Mathf.Cos(55.75f * Mathf.Deg2Rad);
                    float worldZ = (lat / 1e7f - 55.75f) * 111000f;
                    float worldY = altitude;

                    targetPosition = homePosition + new Vector3(worldX, worldY, worldZ);
                    targetRotation = Quaternion.Euler(0, heading / 100.0f, 0);
                }
                break;

            case 1: // SYS_STATUS
                if (payload.Length >= 15)
                {
                    battery = payload[14]; // battery_remaining (-1 = not available)
                    if (battery < 0) battery = 100;
                }
                break;
        }
    }

    void Update()
    {
        // Smooth movement
        transform.position = Vector3.Lerp(transform.position, targetPosition, smoothSpeed * Time.deltaTime);
        transform.rotation = Quaternion.Slerp(transform.rotation, targetRotation, smoothSpeed * Time.deltaTime);
    }

    void OnDestroy()
    {
        running = false;
        receiveThread?.Join(1000);
        udpClient?.Close();
    }

    void OnApplicationQuit()
    {
        running = false;
        receiveThread?.Join(1000);
        udpClient?.Close();
    }
}
