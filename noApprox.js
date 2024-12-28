const vertexShaderSource = `
#version 300 es
precision highp float;
precision highp int;

uniform highp usampler2D u_texture;


uniform mat4 projection, view;
uniform vec2 focal;
uniform vec2 viewport;

in vec2 position;
in int index;

out vec4 vColor;
out vec2 vPosition;
out float zPos;
out vec4 viewPort;
out mat2 Q;

void main () {

    viewPort = vec4(viewport, 0.0, 0.0);

    uvec4 cen = texelFetch(u_texture, ivec2((uint(index) & 0x3ffu) << 1, uint(index) >> 10), 0);
    vec4 cam = view * vec4(uintBitsToFloat(cen.xyz), 1); 
    vec4 pos2d = projection * cam; 

    float clip = 1.2 * pos2d.w;
    if (pos2d.z < -clip || pos2d.x < -clip || pos2d.x > clip || pos2d.y < -clip || pos2d.y > clip) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        return;
    }



    uvec4 cov = texelFetch(u_texture, ivec2(((uint(index) & 0x3ffu) << 1) | 1u, uint(index) >> 10), 0);
    vec2 u1 = unpackHalf2x16(cov.x), u2 = unpackHalf2x16(cov.y), u3 = unpackHalf2x16(cov.z);
    mat3 Vrk = mat3(u1.x, u1.y, u2.x, u1.y, u2.y, u3.x, u2.x, u3.x, u3.y); // Cov3D

    //float focal_y = viewport.y / (2.0 * tan(90. / 2.0 / 180. * 3.14159));
    //float focal_x = focal_y * (viewport.x / viewport.y);

    mat3 J = mat3(
        focal.x / cam.z, 0., -(focal.x * cam.x) / (cam.z * cam.z),
        0., - focal.y / cam.z, (focal.y * cam.y) / (cam.z * cam.z),
        0., 0., 0.
    );

    mat3 T = transpose(mat3(view)) * J;
    mat3 cov2d = transpose(T) * Vrk * T;

    float mid = (cov2d[0][0] + cov2d[1][1]) / 2.0;
    float radius = length(vec2((cov2d[0][0] - cov2d[1][1]) / 2.0, cov2d[0][1]));
    float lambda1 = mid + radius, lambda2 = mid - radius;

    if(lambda2 < 0.0) return;
    vec2 diagonalVector = normalize(vec2(cov2d[0][1], lambda1 - cov2d[0][0]));
    vec2 majorAxis = min(sqrt(2.0 * lambda1), 1024.0) * diagonalVector;
    vec2 minorAxis = min(sqrt(2.0 * lambda2), 1024.0) * vec2(diagonalVector.y, -diagonalVector.x);

    //majorAxis = sqrt(2.0 * lambda1) * diagonalVector;
    //minorAxis = sqrt(2.0 * lambda2) * vec2(diagonalVector.y, -diagonalVector.x);

    vColor = clamp(pos2d.z/pos2d.w+1.0, 0.0, 1.0) * vec4((cov.w) & 0xffu, (cov.w >> 8) & 0xffu, (cov.w >> 16) & 0xffu, (cov.w >> 24) & 0xffu) / 255.0;
    vPosition = position;

    vec2 vCenter =  vec2(pos2d) / pos2d.w;//pos2d.xy;//
    gl_Position = vec4(
        vCenter
        + position.x * majorAxis / viewport
        + position.y * minorAxis / viewport, pos2d.z / pos2d.w, 1.0);


    //gl_Position.xyz *= 100.;
    // For depth rendering
    zPos = cam.z / 10.;

    viewPort.zw = vCenter; //vCenter * 0.5 * viewport + 0.5 * viewport;
    viewPort.x = cov2d[0][0] * cov2d[1][1] - cov2d[1][0] * cov2d[0][1];
    Q = inverse(mat2(cov2d[0][0], cov2d[1][0],
                 cov2d[0][1], cov2d[1][1]));
}
`.trim();

const fragmentShaderSource = `
#version 300 es
precision highp float;
precision highp int;


in vec4 vColor;
in vec2 vPosition;

in float zPos;
in vec4 viewPort;
in mat2 Q;

out vec4 fragColor;

void main () {


    vec2 center =  viewPort.zw;
    vec2 pos = gl_FragCoord.xy / viewPort.xy;
    vec2 v = pos - center;
    float det = viewPort.x;


    //float A = -dot(vPosition, vPosition);
    float A = -0.5 * dot(v, Q*v);
    
    if (A < -0.1) discard;
    //if (A < -2.0 * log(6.28318 * 0.9 * sqrt(det))) discard;

    float B = exp(A) * vColor.a;
    
    // Depth version
    //fragColor = vec4(vec3(B * zPos), B);

    // Color version
    fragColor = vec4(vColor.rgb * B,B);
}