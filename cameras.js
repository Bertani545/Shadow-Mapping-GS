export function getViewMatrix(camera) {
    const R = camera.rotation.flat();
    const t = camera.position;
    const camToWorld = [
        [R[0], R[1], R[2], 0],
        [R[3], R[4], R[5], 0],
        [R[6], R[7], R[8], 0],
        [
            -t[0] * R[0] - t[1] * R[3] - t[2] * R[6],
            -t[0] * R[1] - t[1] * R[4] - t[2] * R[7],
            -t[0] * R[2] - t[1] * R[5] - t[2] * R[8],
            1,
        ],
    ].flat();
    return camToWorld;
}

export const intrinsicValuesCamera = 
{
    getProjectionMatrix(fx, fy, width, height){
    const znear = 0.2;
    const zfar = 20;

    return [
        [(2 * fx) / width, 0, 0, 0],
        [0, -(2 * fy) / height, 0, 0],
        [0, 0, zfar / (zfar - znear), 1],
        [0, 0, -(zfar * znear) / (zfar - znear), 0],
    ].flat();
    },

    vertexShaderSource : `
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

void main () {


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

}
`.trim()

}



export const orthographicProjection = 
{
    getProjectionMatrix(fx, fy, width, height) {
    const znear = 0.2;
    const zfar = 20;
    const left = -5;
    const right = 5;
    const bottom = -5;
    const top = 5;

    return [
        [2 / (right - left), 0, 0, 0],
        [0, -2 / (top - bottom), 0, 0],
        [0, 0, 2 / (zfar - znear), 0],
        [0, 0, znear / (zfar - znear), 1],
    ].flat();
},

    vertexShaderSource : `
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

void main () {
    uvec4 cen = texelFetch(u_texture, ivec2((uint(index) & 0x3ffu) << 1, uint(index) >> 10), 0);
    vec4 cam = view * vec4(uintBitsToFloat(cen.xyz), 1); 
    vec4 pos2d = projection * cam; // ortographic

    float clip = 1.2 * pos2d.w;
    if (pos2d.z < -clip || pos2d.z > clip || pos2d.x < -clip || pos2d.x > clip || pos2d.y < -clip || pos2d.y > clip) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        return;
    }

    uvec4 cov = texelFetch(u_texture, ivec2(((uint(index) & 0x3ffu) << 1) | 1u, uint(index) >> 10), 0);
    vec2 u1 = unpackHalf2x16(cov.x), u2 = unpackHalf2x16(cov.y), u3 = unpackHalf2x16(cov.z);
    mat3 Vrk = mat3(u1.x, u1.y, u2.x, u1.y, u2.y, u3.x, u2.x, u3.x, u3.y); // Cov3D transpose
/*
    float focal_y = viewport.y / (2.0 * tan(120. / 2.0 / 180. * 3.14159));
    float focal_x = focal_y * (viewport.x / viewport.y);

    mat3 J = mat3(
        focal_x / cam.z, 0., -(focal_x * cam.x) / (cam.z * cam.z),
        0., -focal_y / cam.z, (focal_y * cam.y) / (cam.z * cam.z),
        0., 0., 0.
    );
*/

    mat3 J = mat3(
        viewport.x/focal.x, 0., 0.,
        0., viewport.y/focal.y, 0.,
        0., 0., 0.
    );

    // The values are the size of the viewport and the limits of the projection matrix (top-bottom, left-right)
    J = mat3(
        viewport.x/10., 0., 0.,
        0., viewport.y/10., 0.,
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

    vColor =  vec4((cov.w) & 0xffu, (cov.w >> 8) & 0xffu, (cov.w >> 16) & 0xffu, (cov.w >> 24) & 0xffu) / 255.0;
    vPosition = position;

    vec2 vCenter =  vec2(pos2d) / pos2d.w;//pos2d.xy;//
    gl_Position = vec4(
        vCenter
        + position.x * majorAxis / viewport
        + position.y * minorAxis / viewport, pos2d.z / pos2d.w, 1.0);


    //gl_Position.xyz *= 10.;
    // For depth rendering
    zPos = cam.z / 10.;

}
`.trim()
}


export const perspectiveProjection = 
{
    getProjectionMatrix(fx, fy, width, height) {
        const znear = 0.2;
        const zfar = 20;

        const FOV = 90  / 2;
        const aspect = width / height;
        const top = Math.tan(FOV * Math.PI / 180) *znear;
        const bottom = -top;
        const right = top * aspect;
        const left = -right;

        return [
            [(2 * znear) / (right - left), 0, 0, 0],
            [0, -(2 * znear) / (top - bottom), 0, 0],
            [0,0, (zfar + znear) / (zfar - znear), 1],
            [0, 0, -(2*zfar * znear) / (zfar - znear), 0],
        ].flat();
    },

    vertexShaderSource : `
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

void main () {
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
    mat3 Vrk = mat3(u1.x, u1.y, u2.x, u1.y, u2.y, u3.x, u2.x, u3.x, u3.y); // Cov3D transpose

    float focal_y = viewport.y / (2.0 * tan(90. / 2.0 / 180. * 3.14159));
    float focal_x = focal_y * (viewport.x / viewport.y);

    mat3 J = mat3(
        focal_x / cam.z, 0., -(focal_x * cam.x) / (cam.z * cam.z),
        0., -focal_y / cam.z, (focal_y * cam.y) / (cam.z * cam.z),
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

}
`.trim()
}

/*
function getProjectionMatrix(fx, fy, width, height) {
    const znear = 0.2;
    const zfar = 200;

    const FOV = 120  / 2;
    const aspect = width / height;
    const top = Math.tan(FOV * Math.PI / 180) * znear;
    const bottom = -top;
    const right = top * aspect;
    const left = -right;

    return [
        [(2 * znear) / (right - left), 0, 0, 0],
        [0, -(2 * znear) / (top - bottom), 0, 0],
        [0,0, (zfar + znear) / (zfar - znear), 1],
        [0, 0, -(2*zfar * znear) / (zfar - znear), 0],
    ].flat();
}
*/


export let cameras = [
    {
        id: 0,
        img_name: "00001",
        width: 1959,
        height: 1090,
        position: [
            -3.0089893469241797, -0.11086489695181866, -3.7527640949141428,
        ],
        rotation: [
            [0.876134201218856, 0.06925962026449776, 0.47706599800804744],
            [-0.04747421839895102, 0.9972110940209488, -0.057586739349882114],
            [-0.4797239414934443, 0.027805376500959853, 0.8769787916452908],
        ],
        fy: 1164.6601287484507,
        fx: 1159.5880733038064,
    },
    {
        id: 1,
        img_name: "00009",
        width: 1959,
        height: 1090,
        position: [
            -2.5199776022057296, -0.09704735754873686, -3.6247725540304545,
        ],
        rotation: [
            [0.9982731285632193, -0.011928707708098955, -0.05751927260507243],
            [0.0065061360949636325, 0.9955928229282383, -0.09355533724430458],
            [0.058381769258182864, 0.09301955098900708, 0.9939511719154457],
        ],
        fy: 1164.6601287484507,
        fx: 1159.5880733038064,
    },
    {
        id: 2,
        img_name: "00017",
        width: 1959,
        height: 1090,
        position: [
            -0.7737533667465242, -0.3364271945329695, -2.9358969417573753,
        ],
        rotation: [
            [0.9998813418672372, 0.013742375651625236, -0.0069605529394208224],
            [-0.014268370388586709, 0.996512943252834, -0.08220929105659476],
            [0.00580653013657589, 0.08229885200307129, 0.9965907801935302],
        ],
        fy: 1164.6601287484507,
        fx: 1159.5880733038064,
    },
    {
        id: 3,
        img_name: "00025",
        width: 1959,
        height: 1090,
        position: [
            1.2198221749590001, -0.2196687861401182, -2.3183162007028453,
        ],
        rotation: [
            [0.9208648867765482, 0.0012010625395201253, 0.389880004297208],
            [-0.06298204172269357, 0.987319521752825, 0.14571693239364383],
            [-0.3847611242348369, -0.1587410451475895, 0.9092635249821667],
        ],
        fy: 1164.6601287484507,
        fx: 1159.5880733038064,
    },
    {
        id: 4,
        img_name: "00033",
        width: 1959,
        height: 1090,
        position: [
            1.742387858893817, -0.13848225198886954, -2.0566370113193146,
        ],
        rotation: [
            [0.24669889292141334, -0.08370189346592856, -0.9654706879349405],
            [0.11343747891376445, 0.9919082664242816, -0.05700815184573074],
            [0.9624300466054861, -0.09545671285663988, 0.2541976029815521],
        ],
        fy: 1164.6601287484507,
        fx: 1159.5880733038064,
    },
    {
        id: 5,
        img_name: "00041",
        width: 1959,
        height: 1090,
        position: [
            3.6567309419223935, -0.16470990600750707, -1.3458085590422042,
        ],
        rotation: [
            [0.2341293058324528, -0.02968330457755884, -0.9717522161434825],
            [0.10270823606832301, 0.99469554638321, -0.005638106875665722],
            [0.9667649592295676, -0.09848690996657204, 0.2359360976431732],
        ],
        fy: 1164.6601287484507,
        fx: 1159.5880733038064,
    },
    {
        id: 6,
        img_name: "00049",
        width: 1959,
        height: 1090,
        position: [
            3.9013554243203497, -0.2597500978038105, -0.8106154188297828,
        ],
        rotation: [
            [0.6717235545638952, -0.015718162115524837, -0.7406351366386528],
            [0.055627354673906296, 0.9980224478387622, 0.029270992841185218],
            [0.7387104058127439, -0.060861588786650656, 0.6712695459756353],
        ],
        fy: 1164.6601287484507,
        fx: 1159.5880733038064,
    },
    {
        id: 7,
        img_name: "00057",
        width: 1959,
        height: 1090,
        position: [4.742994605467533, -0.05591660945412069, 0.9500365976084458],
        rotation: [
            [-0.17042655709210375, 0.01207080756938, -0.9852964448542146],
            [0.1165090336695526, 0.9931575292530063, -0.00798543433078162],
            [0.9784581921120181, -0.1161568667478904, -0.1706667764862097],
        ],
        fy: 1164.6601287484507,
        fx: 1159.5880733038064,
    },
    {
        id: 8,
        img_name: "00065",
        width: 1959,
        height: 1090,
        position: [4.34676307626522, 0.08168160516967145, 1.0876221470355405],
        rotation: [
            [-0.003575447631888379, -0.044792503246552894, -0.9989899137764799],
            [0.10770152645126597, 0.9931680875192705, -0.04491693593046672],
            [0.9941768441149182, -0.10775333677534978, 0.0012732004866391048],
        ],
        fy: 1164.6601287484507,
        fx: 1159.5880733038064,
    },
    {
        id: 9,
        img_name: "00073",
        width: 1959,
        height: 1090,
        position: [3.264984351114202, 0.078974937336732, 1.0117200284114904],
        rotation: [
            [-0.026919994628162257, -0.1565891128261527, -0.9872968974090509],
            [0.08444552208239385, 0.983768234577625, -0.1583319754069128],
            [0.9960643893290491, -0.0876350978794554, -0.013259786205163005],
        ],
        fy: 1164.6601287484507,
        fx: 1159.5880733038064,
    },
];



export const orthographicLight = 
{
    getProjectionMatrix(width, height) {
    const znear = 0.2;
    const zfar = 20;
    const left = -5;
    const right = 5;
    const bottom = -5;
    const top = 5;

    return [
        [2 / (right - left), 0, 0, 0],
        [0, -2 / (top - bottom), 0, 0],
        [0, 0, 2 / (zfar - znear), 0],
        [0, 0, znear / (zfar - znear), 1],
    ].flat();
},

    vertexShaderSource : `
#version 300 es
precision highp float;
precision highp int;

uniform highp usampler2D u_texture;


uniform mat4 projection, view;
uniform vec2 viewport;

in vec2 position;
in int index;

out vec2 vPosition;
out float zPos;
out float alpha;

void main () {
    uvec4 cen = texelFetch(u_texture, ivec2((uint(index) & 0x3ffu) << 1, uint(index) >> 10), 0);
    vec4 cam = view * vec4(uintBitsToFloat(cen.xyz), 1); 
    vec4 pos2d = projection * cam; // ortographic

    float clip = 1.2 * pos2d.w;
    if (pos2d.z < -clip || pos2d.z > clip || pos2d.x < -clip || pos2d.x > clip || pos2d.y < -clip || pos2d.y > clip) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        return;
    }

    uvec4 cov = texelFetch(u_texture, ivec2(((uint(index) & 0x3ffu) << 1) | 1u, uint(index) >> 10), 0);
    vec2 u1 = unpackHalf2x16(cov.x), u2 = unpackHalf2x16(cov.y), u3 = unpackHalf2x16(cov.z);
    mat3 Vrk = mat3(u1.x, u1.y, u2.x, u1.y, u2.y, u3.x, u2.x, u3.x, u3.y); // Cov3D transpose


    // The values are the size of the viewport and the limits of the projection matrix (top-bottom, left-right)
    mat3 J = mat3(
        viewport.x/10., 0., 0.,
        0., viewport.y/10., 0.,
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

    vPosition = position;

    vec2 vCenter =  vec2(pos2d) / pos2d.w;//pos2d.xy;//
    gl_Position = vec4(
        vCenter
        + position.x * majorAxis / viewport
        + position.y * minorAxis / viewport, 0., 1.0);


    //gl_Position.xyz *= 10.;
    // For depth rendering
    zPos = pos2d.z / pos2d.w;


    alpha = clamp(pos2d.z/pos2d.w+1.0, 0.0, 1.0) * float((cov.w >> 24) & 0xffu) / 255.0;

}
`.trim()
}


export const perspectiveLight = 
{
    getProjectionMatrix(width, height) {
        const znear = 0.2;
        const zfar = 20;

        const FOV = 90  / 2;
        const aspect = width / height;
        const top = Math.tan(FOV * Math.PI / 180) *znear;
        const bottom = -top;
        const right = top * aspect;
        const left = -right;

        return [
            [(2 * znear) / (right - left), 0, 0, 0],
            [0, -(2 * znear) / (top - bottom), 0, 0],
            [0,0, (zfar + znear) / (zfar - znear), 1],
            [0, 0, -(2*zfar * znear) / (zfar - znear), 0],
        ].flat();
    },

    vertexShaderSource : `
#version 300 es
precision highp float;
precision highp int;

uniform highp usampler2D u_texture;


uniform mat4 projection, view;
uniform vec2 viewport;

in vec2 position;
in int index;

out vec2 vPosition;
out float zPos;
out float alpha;

void main () {
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
    mat3 Vrk = mat3(u1.x, u1.y, u2.x, u1.y, u2.y, u3.x, u2.x, u3.x, u3.y); // Cov3D transpose

    float focal_y = viewport.y / (2.0 * tan(90. / 2.0 / 180. * 3.14159));
    float focal_x = focal_y * (viewport.x / viewport.y);

    mat3 J = mat3(
        focal_x / cam.z, 0., -(focal_x * cam.x) / (cam.z * cam.z),
        0., -focal_y / cam.z, (focal_y * cam.y) / (cam.z * cam.z),
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

    vPosition = position;

    vec2 vCenter =  vec2(pos2d) / pos2d.w;//pos2d.xy;//
    gl_Position = vec4(
        vCenter
        + position.x * majorAxis / viewport
        + position.y * minorAxis / viewport, 0., 1.0);


    // For depth rendering
    zPos = pos2d.z / pos2d.w;

    alpha = clamp(pos2d.z/pos2d.w+1.0, 0.0, 1.0) * float((cov.w >> 24) & 0xffu) / 255.0;

}
`.trim()
}