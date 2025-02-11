
import {multiply4, invert4, rotate4, translate4} from "./matrixOperations.js";

import {cameras, getViewMatrix, intrinsicValuesCamera, orthographicProjection, perspectiveProjection} from "./cameras.js"

import {createProgram} from "./webGLFuncs.js";

import {LightSource} from "./light.js"



let camera = cameras[0];
const {getProjectionMatrix, vertexShaderSource} =  perspectiveProjection;

const gl = canvas.getContext("webgl2", {
        antialias: false,
    });
let theta = 0.0;


function createWorker(self) {

    let buffer;
    let vertexCount = 0;
    let viewProj;
    // 6*4 + 4 + 4 = 8*4
    // XYZ - Position (Float32)
    // XYZ - Scale (Float32)
    // RGBA - colors (uint8)
    // IJKL - quaternion/rot (uint8)
    const rowLength = 3 * 4 + 3 * 4 + 4 + 4;
    let lastProj = [];
    let depthIndex = new Uint32Array();
    let lastVertexCount = 0;

    var _floatView = new Float32Array(1);
    var _int32View = new Int32Array(_floatView.buffer);

    function floatToHalf(float) {
        _floatView[0] = float;
        var f = _int32View[0];

        var sign = (f >> 31) & 0x0001;
        var exp = (f >> 23) & 0x00ff;
        var frac = f & 0x007fffff;

        var newExp;
        if (exp == 0) {
            newExp = 0;
        } else if (exp < 113) {
            newExp = 0;
            frac |= 0x00800000;
            frac = frac >> (113 - exp);
            if (frac & 0x01000000) {
                newExp = 1;
                frac = 0;
            }
        } else if (exp < 142) {
            newExp = exp - 112;
        } else {
            newExp = 31;
            frac = 0;
        }

        return (sign << 15) | (newExp << 10) | (frac >> 13);
    }

    function packHalf2x16(x, y) {
        return (floatToHalf(x) | (floatToHalf(y) << 16)) >>> 0;
    }

    function generateTexture() {
        if (!buffer) return;
        const f_buffer = new Float32Array(buffer);
        const u_buffer = new Uint8Array(buffer);

        var texwidth = 1024 * 2; // Set to your desired width
        var texheight = Math.ceil((2 * vertexCount) / texwidth); // Set to your desired height
        var texdata = new Uint32Array(texwidth * texheight * 4); // 4 components per pixel (RGBA)
        var texdata_c = new Uint8Array(texdata.buffer);
        var texdata_f = new Float32Array(texdata.buffer);

        // Here we convert from a .splat file buffer into a texture
        // With a little bit more foresight perhaps this texture file
        // should have been the native format as it'd be very easy to
        // load it into webgl.
        for (let i = 0; i < vertexCount; i++) {
            // x, y, z
            texdata_f[8 * i + 0] = f_buffer[8 * i + 0];
            texdata_f[8 * i + 1] = f_buffer[8 * i + 1];
            texdata_f[8 * i + 2] = f_buffer[8 * i + 2];

            // r, g, b, a
            texdata_c[4 * (8 * i + 7) + 0] = u_buffer[32 * i + 24 + 0];
            texdata_c[4 * (8 * i + 7) + 1] = u_buffer[32 * i + 24 + 1];
            texdata_c[4 * (8 * i + 7) + 2] = u_buffer[32 * i + 24 + 2];
            texdata_c[4 * (8 * i + 7) + 3] = u_buffer[32 * i + 24 + 3];

            // quaternions
            let scale = [
                f_buffer[8 * i + 3 + 0],
                f_buffer[8 * i + 3 + 1],
                f_buffer[8 * i + 3 + 2],
            ];
            let rot = [
                (u_buffer[32 * i + 28 + 0] - 128) / 128,
                (u_buffer[32 * i + 28 + 1] - 128) / 128,
                (u_buffer[32 * i + 28 + 2] - 128) / 128,
                (u_buffer[32 * i + 28 + 3] - 128) / 128,
            ];

            // Compute the matrix product of S and R (M = S * R)
            const M = [
                1.0 - 2.0 * (rot[2] * rot[2] + rot[3] * rot[3]),
                2.0 * (rot[1] * rot[2] + rot[0] * rot[3]),
                2.0 * (rot[1] * rot[3] - rot[0] * rot[2]),

                2.0 * (rot[1] * rot[2] - rot[0] * rot[3]),
                1.0 - 2.0 * (rot[1] * rot[1] + rot[3] * rot[3]),
                2.0 * (rot[2] * rot[3] + rot[0] * rot[1]),

                2.0 * (rot[1] * rot[3] + rot[0] * rot[2]),
                2.0 * (rot[2] * rot[3] - rot[0] * rot[1]),
                1.0 - 2.0 * (rot[1] * rot[1] + rot[2] * rot[2]),
            ].map((k, i) => k * scale[Math.floor(i / 3)]);

            const sigma = [
                M[0] * M[0] + M[3] * M[3] + M[6] * M[6],
                M[0] * M[1] + M[3] * M[4] + M[6] * M[7],
                M[0] * M[2] + M[3] * M[5] + M[6] * M[8],
                M[1] * M[1] + M[4] * M[4] + M[7] * M[7],
                M[1] * M[2] + M[4] * M[5] + M[7] * M[8],
                M[2] * M[2] + M[5] * M[5] + M[8] * M[8],
            ];

            texdata[8 * i + 4] = packHalf2x16(4 * sigma[0], 4 * sigma[1]);
            texdata[8 * i + 5] = packHalf2x16(4 * sigma[2], 4 * sigma[3]);
            texdata[8 * i + 6] = packHalf2x16(4 * sigma[4], 4 * sigma[5]);
        }

        self.postMessage({ texdata, f_buffer, texwidth, texheight }, [texdata.buffer]);
    }

    function runSort(viewProj) {
        if (!buffer) return;
        const f_buffer = new Float32Array(buffer);
        if (lastVertexCount == vertexCount) {
            let dot =
                lastProj[2] * viewProj[2] +
                lastProj[6] * viewProj[6] +
                lastProj[10] * viewProj[10];
            if (Math.abs(dot - 1) < 0.01) {
                return;
            }
        } else {
            generateTexture();
            lastVertexCount = vertexCount;
        }

        //console.time("sort");
        let maxDepth = -Infinity;
        let minDepth = Infinity;
        let sizeList = new Int32Array(vertexCount);
        for (let i = 0; i < vertexCount; i++) {
            let depth =
                ((viewProj[2] * f_buffer[8 * i + 0] +
                    viewProj[6] * f_buffer[8 * i + 1] +
                    viewProj[10] * f_buffer[8 * i + 2]) *
                    4096) |
                0;
            sizeList[i] = depth;
            if (depth > maxDepth) maxDepth = depth;
            if (depth < minDepth) minDepth = depth;
        }

        // This is a 16 bit single-pass counting sort
        let depthInv = (256 * 256) / (maxDepth - minDepth);
        let counts0 = new Uint32Array(256 * 256);
        for (let i = 0; i < vertexCount; i++) {
            sizeList[i] = ((sizeList[i] - minDepth) * depthInv) | 0;
            counts0[sizeList[i]]++;
        }
        let starts0 = new Uint32Array(256 * 256);
        for (let i = 1; i < 256 * 256; i++)
            starts0[i] = starts0[i - 1] + counts0[i - 1];
        depthIndex = new Uint32Array(vertexCount);
        for (let i = 0; i < vertexCount; i++)
            depthIndex[starts0[sizeList[i]]++] = i;

        //console.timeEnd("sort");

        lastProj = viewProj;
        self.postMessage({ depthIndex, viewProj, vertexCount }, [
            depthIndex.buffer,
        ]);
    }

    function processPlyBuffer(inputBuffer) {
        const ubuf = new Uint8Array(inputBuffer);
        // 10KB ought to be enough for a header...
        const header = new TextDecoder().decode(ubuf.slice(0, 1024 * 10));
        const header_end = "end_header\n";
        const header_end_index = header.indexOf(header_end);
        if (header_end_index < 0)
            throw new Error("Unable to read .ply file header");
        const vertexCount = parseInt(/element vertex (\d+)\n/.exec(header)[1]);
        console.log("Vertex Count", vertexCount);
        let row_offset = 0,
            offsets = {},
            types = {};
        const TYPE_MAP = {
            double: "getFloat64",
            int: "getInt32",
            uint: "getUint32",
            float: "getFloat32",
            short: "getInt16",
            ushort: "getUint16",
            uchar: "getUint8",
        };
        for (let prop of header
            .slice(0, header_end_index)
            .split("\n")
            .filter((k) => k.startsWith("property "))) {
            const [p, type, name] = prop.split(" ");
            const arrayType = TYPE_MAP[type] || "getInt8";
            types[name] = arrayType;
            offsets[name] = row_offset;
            row_offset += parseInt(arrayType.replace(/[^\d]/g, "")) / 8;
        }
        console.log("Bytes per row", row_offset, types, offsets);

        let dataView = new DataView(
            inputBuffer,
            header_end_index + header_end.length,
        );
        let row = 0;
        const attrs = new Proxy(
            {},
            {
                get(target, prop) {
                    if (!types[prop]) throw new Error(prop + " not found");
                    return dataView[types[prop]](
                        row * row_offset + offsets[prop],
                        true,
                    );
                },
            },
        );

        console.time("calculate importance");
        let sizeList = new Float32Array(vertexCount);
        let sizeIndex = new Uint32Array(vertexCount);
        for (row = 0; row < vertexCount; row++) {
            sizeIndex[row] = row;
            if (!types["scale_0"]) continue;
            const size =
                Math.exp(attrs.scale_0) *
                Math.exp(attrs.scale_1) *
                Math.exp(attrs.scale_2);
            const opacity = 1 / (1 + Math.exp(-attrs.opacity));
            sizeList[row] = size * opacity;
        }
        console.timeEnd("calculate importance");

        console.time("sort");
        sizeIndex.sort((b, a) => sizeList[a] - sizeList[b]);
        console.timeEnd("sort");

        // 6*4 + 4 + 4 = 8*4
        // XYZ - Position (Float32)
        // XYZ - Scale (Float32)
        // RGBA - colors (uint8)
        // IJKL - quaternion/rot (uint8)
        const rowLength = 3 * 4 + 3 * 4 + 4 + 4;
        const buffer = new ArrayBuffer(rowLength * vertexCount);

        console.time("build buffer");
        for (let j = 0; j < vertexCount; j++) {
            row = sizeIndex[j];

            const position = new Float32Array(buffer, j * rowLength, 3);
            const scales = new Float32Array(buffer, j * rowLength + 4 * 3, 3);
            const rgba = new Uint8ClampedArray(
                buffer,
                j * rowLength + 4 * 3 + 4 * 3,
                4,
            );
            const rot = new Uint8ClampedArray(
                buffer,
                j * rowLength + 4 * 3 + 4 * 3 + 4,
                4,
            );

            if (types["scale_0"]) {
                const qlen = Math.sqrt(
                    attrs.rot_0 ** 2 +
                        attrs.rot_1 ** 2 +
                        attrs.rot_2 ** 2 +
                        attrs.rot_3 ** 2,
                );

                rot[0] = (attrs.rot_0 / qlen) * 128 + 128;
                rot[1] = (attrs.rot_1 / qlen) * 128 + 128;
                rot[2] = (attrs.rot_2 / qlen) * 128 + 128;
                rot[3] = (attrs.rot_3 / qlen) * 128 + 128;

                scales[0] = Math.exp(attrs.scale_0);
                scales[1] = Math.exp(attrs.scale_1);
                scales[2] = Math.exp(attrs.scale_2);
            } else {
                scales[0] = 0.01;
                scales[1] = 0.01;
                scales[2] = 0.01;

                rot[0] = 255;
                rot[1] = 0;
                rot[2] = 0;
                rot[3] = 0;
            }

            position[0] = attrs.x;
            position[1] = attrs.y;
            position[2] = attrs.z;

            if (types["f_dc_0"]) {
                const SH_C0 = 0.28209479177387814;
                rgba[0] = (0.5 + SH_C0 * attrs.f_dc_0) * 255;
                rgba[1] = (0.5 + SH_C0 * attrs.f_dc_1) * 255;
                rgba[2] = (0.5 + SH_C0 * attrs.f_dc_2) * 255;
            } else {
                rgba[0] = attrs.red;
                rgba[1] = attrs.green;
                rgba[2] = attrs.blue;
            }
            if (types["opacity"]) {
                rgba[3] = (1 / (1 + Math.exp(-attrs.opacity))) * 255;
            } else {
                rgba[3] = 255;
            }
        }
        console.timeEnd("build buffer");
        return buffer;
    }

    const throttledSort = () => {
        if (!sortRunning) {
            sortRunning = true;
            let lastView = viewProj;
            runSort(lastView);
            setTimeout(() => {
                sortRunning = false;
                if (lastView !== viewProj) {
                    throttledSort();
                }
            }, 0);
        }
    };

    let sortRunning;
    self.onmessage = (e) => {
        if (e.data.ply) {
            vertexCount = 0;
            runSort(viewProj);
            buffer = processPlyBuffer(e.data.ply);
            vertexCount = Math.floor(buffer.byteLength / rowLength);
            postMessage({ buffer: buffer, save: !!e.data.save });
        } else if (e.data.buffer) {
            buffer = e.data.buffer;
            vertexCount = e.data.vertexCount;

        } else if (e.data.vertexCount) {
            vertexCount = e.data.vertexCount;
        } else if (e.data.view) {
            viewProj = e.data.view;
            throttledSort();
        }
    };
}





const fragmentShaderSource = `
#version 300 es
precision highp float;
precision highp int;


in vec4 vColor;
in vec2 vPosition;

in float zPos;

out vec4 fragColor;

void main () {

    float A = -dot(vPosition, vPosition);
    
    if (A < -4.) discard;

    float B = exp(A) * vColor.a;
    
    // Depth version
    //fragColor = vec4(vec3(B * zPos), B);

    // Color version
    fragColor = vec4(vColor.rgb * B, B);

    fragColor = vec4(B*zPos, vColor.yz * B, B);
}

`.trim();



let defaultViewMatrix = [
    0.47, 0.04, 0.88, 0, -0.11, 0.99, 0.02, 0, -0.88, -0.11, 0.47, 0, 0.07,
    0.03, 6.55, 1,
];
let viewMatrix = defaultViewMatrix;


async function main() {
    let carousel = true;
    const params = new URLSearchParams(location.search);
    try {
        viewMatrix = JSON.parse(decodeURIComponent(location.hash.slice(1)));
        carousel = false;
    } catch (err) {}
    const url = new URL(
        // "nike.splat",
        // location.href,
        params.get("url") || "train.splat",
        "https://huggingface.co/cakewalk/splat-data/resolve/main/",
    );
    const req = await fetch(url, {
        mode: "cors", // no-cors, *cors, same-origin
        credentials: "omit", // include, *same-origin, omit
    });
    console.log(req);
    if (req.status != 200)
        throw new Error(req.status + " Unable to load " + req.url);

    const rowLength = 3 * 4 + 3 * 4 + 4 + 4;
    const reader = req.body.getReader();
    let splatData = new Uint8Array(req.headers.get("content-length"));

    const downsample =
        splatData.length / rowLength > 500000 ? 1 : 1 / devicePixelRatio;
    console.log(splatData.length / rowLength, downsample);

    const worker = new Worker(
        URL.createObjectURL(
            new Blob(["(", createWorker.toString(), ")(self)"], {
                type: "application/javascript",
            }),
        ),
    );

    // Passing Light Sources 
    const lightSourcesArray = []
    /* Create the light source class*/
    const lightSource1 = new LightSource(1, [
                [0.9208648867765482, 0.0012010625395201253, 0.389880004297208],
                [-0.06298204172269357, 0.987319521752825, 0.14571693239364383],
                [-0.3847611242348369, -0.1587410451475895, 0.9092635249821667],
            ].flat(),
            [1.2198221749590001, -0.2196687861401182, -2]); 
    
    /*const lightSource1 = new LightSource(1,[
            [0.9982731285632193, -0.011928707708098955, -0.05751927260507243],
            [0.0065061360949636325, 0.9955928229282383, -0.09355533724430458],
            [0.058381769258182864, 0.09301955098900708, 0.9939511719154457],
        ].flat(),
        [
            -2.5199776022057296, -0.09704735754873686, -3.6247725540304545,
        ])*/
    lightSource1.build(gl);

    lightSourcesArray.push(lightSource1);


    const canvas = document.getElementById("canvas");
    const fps = document.getElementById("fps");
    const camid = document.getElementById("camid");

    let projectionMatrix;

    




const vao = gl.createVertexArray();
gl.bindVertexArray(vao); // Makes it current

    const program = createProgram(gl, vertexShaderSource, fragmentShaderSource);
    gl.linkProgram(program);
    gl.useProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        console.error(gl.getProgramInfoLog(program));

    gl.disable(gl.DEPTH_TEST);

    // Enable blending
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(
        gl.ONE_MINUS_DST_ALPHA,
        gl.ONE,
        gl.ONE_MINUS_DST_ALPHA,
        gl.ONE,
    );
    gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);

    const u_projection = gl.getUniformLocation(program, "projection");
    const u_viewport = gl.getUniformLocation(program, "viewport");
    const u_focal = gl.getUniformLocation(program, "focal");
    const u_view = gl.getUniformLocation(program, "view");

    // positions
    const triangleVertices = new Float32Array([-2, -2, 2, -2, 2, 2, -2, 2]);
    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, triangleVertices, gl.STATIC_DRAW);
    const a_position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(a_position);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.vertexAttribPointer(a_position, 2, gl.FLOAT, false, 0, 0);

    var texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    var u_textureLocation = gl.getUniformLocation(program, "u_texture");
    gl.uniform1i(u_textureLocation, 0);

    const indexBuffer = gl.createBuffer();
    const a_index = gl.getAttribLocation(program, "index");
    gl.enableVertexAttribArray(a_index);
    gl.bindBuffer(gl.ARRAY_BUFFER, indexBuffer);
    gl.vertexAttribIPointer(a_index, 1, gl.INT, false, 0, 0);
    gl.vertexAttribDivisor(a_index, 1);







// ----------------------------- Mesh stuff -------------------------------------------------------
    const meshVertexShaderSource = `
#version 300 es
precision highp float;
precision highp int;

uniform mat4 projection, view;
uniform vec2 focal;
uniform float deg;
uniform vec3 trans;
uniform float scale;
//uniform vec2 viewport;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec4 aColor;
//layout(location = 2) in vec3 aNormal;

out vec4 vColor;
//out vec3 vNormal;
out mat4 projecMat;
out mat4 viewM;


mat3 rotationZ(float deg)
{
    float rad = deg * 3.14159 / 180.;
    return mat3(cos(rad), sin(rad), 0., -sin(rad), cos(rad), 0., 0., 0., 1.);
}


void main () {

    gl_Position = projection * view * vec4(scale * rotationZ(deg) * aPosition + trans, 1.0);
    //gl_Position.w = 1.0;

    vColor = aColor;
    //vColor = vec4(gl_Position.z / gl_Position.w);
//  vNormal = aNormal;


}
`.trim();

const meshFragmentShaderSource = `
#version 300 es
precision highp float;

in vec4 vColor;
//in vec3 vNormal;

out vec4 fragColor;

void main () {
    fragColor = vec4(vColor.rgb, gl_FragCoord.z);
}

`.trim();

const meshFragmentShaderSourceShadows = `
#version 300 es
precision highp float;

in vec4 vColor;
//in vec3 vNormal;
//out vec4 fragColor;


void main () {
    // gl_FragDepth = gl_FragCoord.z;
    //fragColor = vec4(gl_FragCoord.z);
}

`.trim();



const cube = {};


cube.VAO = gl.createVertexArray();
gl.bindVertexArray(cube.VAO); // Make it current

const cubeVertices = [
  // Front face
  -1.0, -1.0, 1.0, 1.0, 1.0, 1.0, 1.0,
   1.0, -1.0, 1.0, 1.0, 1.0, 1.0, 1.0,
   1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0,
    -1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0,

  // Back face
  -1.0, -1.0, -1.0, 1.0, 0.0, 0.0, 1.0,
   -1.0, 1.0, -1.0, 1.0, 0.0, 0.0, 1.0,
   1.0, 1.0, -1.0, 1.0, 0.0, 0.0, 1.0,
   1.0, -1.0, -1.0, 1.0, 0.0, 0.0, 1.0,

  // Top face
  -1.0, 1.0, -1.0, 0.0, 1.0, 0.0, 1.0,
  -1.0, 1.0, 1.0, 0.0, 1.0, 0.0, 1.0,
  1.0, 1.0, 1.0, 0.0, 1.0, 0.0, 1.0,
  1.0, 1.0, -1.0, 0.0, 1.0, 0.0, 1.0,

  // Bottom face
  -1.0, -1.0, -1.0, 0.0, 0.0, 1.0, 1.0,
  1.0, -1.0, -1.0, 0.0, 0.0, 1.0, 1.0,
  1.0, -1.0, 1.0, 0.0, 0.0, 1.0, 1.0,
  -1.0, -1.0, 1.0, 0.0, 0.0, 1.0, 1.0,

  // Right face
  1.0, -1.0, -1.0, 1.0, 1.0, 0.0, 1.0,
  1.0, 1.0, -1.0, 1.0, 1.0, 0.0, 1.0,
  1.0, 1.0, 1.0, 1.0, 1.0, 0.0, 1.0,
  1.0, -1.0, 1.0, 1.0, 1.0, 0.0, 1.0,

  // Left face
  -1.0, -1.0, -1.0, 1.0, 0.0, 1.0, 1.0,
  -1.0, -1.0, 1.0, 1.0, 0.0, 1.0, 1.0,
  -1.0, 1.0, 1.0, 1.0, 0.0, 1.0, 1.0,
  -1.0, 1.0, -1.0, 1.0, 0.0, 1.0, 1.0,
];


cube.Program = createProgram(gl, meshVertexShaderSource, meshFragmentShaderSource);
gl.linkProgram(cube.Program);
gl.useProgram(cube.Program);

if (!gl.getProgramParameter(cube.Program, gl.LINK_STATUS))
    console.error(gl.getProgramInfoLog(cube.Program));
cube.projection = gl.getUniformLocation(cube.Program, "projection");
cube.view = gl.getUniformLocation(cube.Program, "view");
cube.degrees = gl.getUniformLocation(cube.Program, "deg");
cube.translation = gl.getUniformLocation(cube.Program, "trans");
cube.scale = gl.getUniformLocation(cube.Program, "scale");


// Vertices
cube.VertexBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, cube.VertexBuffer );
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(cubeVertices), gl.STATIC_DRAW);
//const mesh_position = gl.getAttribLocation(program, "aPosition");
//gl.enableVertexAttribArray(mesh_position);
gl.enableVertexAttribArray(0);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 7*4, 0);
gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 7*4, 3 * 4);


cube.IndexBuffer = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cube.IndexBuffer);
  cube.Indices = [
    0,
    1,
    2,
    0,
    2,
    3, // front
    4,
    5,
    6,
    4,
    6,
    7, // back
    8,
    9,
    10,
    8,
    10,
    11, // top
    12,
    13,
    14,
    12,
    14,
    15, // bottom
    16,
    17,
    18,
    16,
    18,
    19, // right
    20,
    21,
    22,
    20,
    22,
    23 // left
  ];
gl.bufferData(
    gl.ELEMENT_ARRAY_BUFFER,
    new Uint16Array(cube.Indices),
    gl.STATIC_DRAW,
  );


// Shadow stuff
cube.ShadowProgram = createProgram(gl, meshVertexShaderSource, meshFragmentShaderSourceShadows);
gl.linkProgram(cube.ShadowProgram);
gl.useProgram(cube.ShadowProgram);

if (!gl.getProgramParameter(cube.ShadowProgram, gl.LINK_STATUS))
    console.error(gl.getProgramInfoLog(cube.ShadowProgram));
cube.ShadowProjection = gl.getUniformLocation(cube.ShadowProgram, "projection");
cube.ShadowView = gl.getUniformLocation(cube.ShadowProgram, "view");
cube.ShadowDegrees = gl.getUniformLocation(cube.ShadowProgram, "deg");
cube.ShadowTrans = gl.getUniformLocation(cube.ShadowProgram, "trans");
cube.ShadowScale = gl.getUniformLocation(cube.ShadowProgram, "scale");
// ------------------------------- Quad --------------------------
const quadVertexShaderSource = `
#version 300 es
 
// an attribute is an input (in) to a vertex shader.
// It will receive data from a buffer
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_texCoord;

uniform vec2 u_resolution;
uniform float u_flipY;

out vec2  v_texCoord;


// all shaders have a main function
void main() {
  
  v_texCoord = a_texCoord; //Goes to the fragment shader

  //vec2 pos_clipSpace = ((a_position / u_resolution) * 2.0 - 1.0) * vec2(1.0, -1.0); //Canvas goes from 0 to 1 in y axis
 
  // gl_Position is a special variable a vertex shader
  // is responsible for setting
  gl_Position = vec4(a_position * vec2(1, -1) , 0.0, 1.0);
}
`.trim();

const meshesQuadFragmentShaderSource = `
#version 300 es
 
// fragment shaders don't have a default precision so we need
// to pick one. highp is a good default. It means "high precision"
precision highp float;

uniform highp sampler2D u_colorTexture;
uniform highp sampler2D u_depthTexture;
uniform mat4 projection, view;
uniform mat4 lightTransformation; // Only one for now

uniform vec2 viewport;

in vec2 v_texCoord;


// we need to declare an output for the fragment shader
out vec4 outColor;
 
void main() {
    vec4 pixel_info = texture(u_colorTexture, v_texCoord).rgba;

    vec4 coord = gl_FragCoord;
    vec4 ndc = vec4(gl_FragCoord.xy / viewport * 2.0 - 1.0,
                    pixel_info.a * 2.0 -1.,
                    1.0);
    vec4 view_space = inverse(projection) * ndc;
    view_space.xyz /= view_space.w;


    vec4 global_space = inverse(view) * vec4(view_space.xyz, 1.0);


    // Transform to light space
    vec4 light_space = lightTransformation * vec4(global_space.xyz, 1.0);
    light_space /= light_space.w;

    if(abs(light_space.x) > 1.0 || abs(light_space.y) > 1.0)
    {
        outColor = vec4(pixel_info.rgb, 1.0);
        return;
    }

    light_space.xyz = light_space.xyz * 0.5 + 0.5;
    

    float closest_depth =  texture(u_depthTexture, light_space.xy).r;
    float bias = 0.005;
    //float bias = max(0.005 * (1.0 - dot(vec3(0, 0, 1), normalize(view_space.xyz))), 0.01);

    float shadow = light_space.z - bias > closest_depth  ? 0.5 : 1.0;
    
    
    outColor = vec4(pixel_info.rgb * shadow, 1.0);

    //outColor = vec4(vec3(global_space.z), 1.0);
    //outColor = vec4(texture(u_depthTexture, v_texCoord).g);

    //outColor = vec4(pixel_info.b);
}
`.trim();

const gaussianQuadFragmentShaderSource = `
#version 300 es
 
// fragment shaders don't have a default precision so we need
// to pick one. highp is a good default. It means "high precision"
precision highp float;

uniform highp sampler2D u_colorTexture;
uniform highp sampler2D u_depthTexture;
uniform mat4 projection, view;
uniform mat4 lightTransformation; // Only one for now

uniform vec2 viewport;

in vec2 v_texCoord;


// we need to declare an output for the fragment shader
out vec4 outColor;
 
void main() {
    vec4 pixel_info = texture(u_colorTexture, v_texCoord).rgba;

    vec4 coord = gl_FragCoord;
    vec4 ndc = vec4(gl_FragCoord.xy / viewport * 2.0 - 1.0,
                    pixel_info.r * 2.0 -1.,
                    1.0);
    vec4 view_space = inverse(projection) * ndc;
    view_space /= view_space.w;


    vec4 global_space = inverse(view) * view_space;


    // Transform to light space
    vec4 light_space = lightTransformation * vec4(global_space.xyz, 1.0);
    light_space /= light_space.w;

    if(abs(light_space.x) > 1.0 || abs(light_space.y) > 1.0)
    {
        outColor = pixel_info.rgba;
        return;
    }

    light_space.xyz = light_space.xyz * 0.5 + 0.5;
    


    vec2 depth_info =  texture(u_depthTexture, light_space.xy).gb;

    if(depth_info.y < 1.0)
    {
        // Its already in shadow
        outColor = pixel_info.rgba;
        return;
    }

    float bias = 0.005;
    //float bias = max(0.005 * (1.0 - dot(vec3(0, 0, 1), normalize(view_space.xyz))), 0.01);
    float shadow = light_space.z - bias > depth_info.x  ? 0.5 : 1.0;

    
    
    outColor = vec4(pixel_info.rgb * shadow, pixel_info.a);
  
    //outColor = vec4(vec3(texture(u_depthTexture, light_space.xy).r), pixel_info.a);
    //outColor = vec4(pixel_info.rgb, pixel_info.a);

}
`.trim();



const vaoQuad = gl.createVertexArray();
gl.bindVertexArray(vaoQuad); // Make it current
const quadVertices = [
  // XY         UV
  -1, -1,  0, 1,
  -1,  1,  0, 0,
   1, -1,  1, 1,
   1,  1,  1, 0,
];


const quadIndices = [
    0, 1, 2,
    1, 2, 3,
];

var quadVertexBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadVertexBuffer);
var quadIndexBuffer = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quadIndexBuffer);

gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(quadVertices), gl.STATIC_DRAW);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(quadIndices), gl.STATIC_DRAW);

gl.enableVertexAttribArray(0);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 4*4, 0);
gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 4*4, 2 * 4);


const quadGaussian = {}
const quadMeshes = {}

quadGaussian.Program = createProgram(gl, quadVertexShaderSource, gaussianQuadFragmentShaderSource);
quadMeshes.Program = createProgram(gl, quadVertexShaderSource, meshesQuadFragmentShaderSource);

gl.linkProgram(quadGaussian.Program);
gl.useProgram(quadGaussian.Program);

quadGaussian.Projection = gl.getUniformLocation(quadGaussian.Program, "projection");
quadGaussian.View =       gl.getUniformLocation(quadGaussian.Program, "view");
quadGaussian.LightTrans = gl.getUniformLocation(quadGaussian.Program, "lightTransformation");
quadGaussian.ImageTex =   gl.getUniformLocation(quadGaussian.Program, "u_colorTexture");
quadGaussian.DepthTex =   gl.getUniformLocation(quadGaussian.Program, "u_depthTexture");
quadGaussian.Viewport =   gl.getUniformLocation(quadGaussian.Program, "viewport");


gl.linkProgram(quadMeshes.Program);
gl.useProgram(quadMeshes.Program);

quadMeshes.Projection = gl.getUniformLocation(quadMeshes.Program, "projection");
quadMeshes.View =       gl.getUniformLocation(quadMeshes.Program, "view");
quadMeshes.LightTrans = gl.getUniformLocation(quadMeshes.Program, "lightTransformation");
quadMeshes.ImageTex =   gl.getUniformLocation(quadMeshes.Program, "u_colorTexture");
quadMeshes.DepthTex =   gl.getUniformLocation(quadMeshes.Program, "u_depthTexture");
quadMeshes.Viewport =   gl.getUniformLocation(quadMeshes.Program, "viewport");



// ----------------------------------------------------------------------

// ----------------------------------- Create color buffers --------------------------


const fboMesh = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, fboMesh);
// Tell WebGL how to convert from clip space to pixels
gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);


// Create a texture for the color buffer.
    const meshColorBuffer = gl.createTexture();

// make unit i the active texture unit
gl.activeTexture(gl.TEXTURE0 + 1);

// Bind texture to 'texture unit i' 2D bind point
gl.bindTexture(gl.TEXTURE_2D, meshColorBuffer);

// Set the parameters so we don't need mips and so we're not filtering
// and we don't repeat
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);


gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.canvas.width, gl.canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
// Bind the texture as where color is going to be written
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, meshColorBuffer, 0);


// Depth buffer
const sharedDepthBuffer = gl.createRenderbuffer();

// Bind texture to 'texture unit i' 2D bind point
gl.bindRenderbuffer(gl.RENDERBUFFER, sharedDepthBuffer);
gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, gl.canvas.width, gl.canvas.height);
gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, sharedDepthBuffer);

console.log(gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE)
// -------------------------------- FBO gaussianas -------------------------

const fboGaussians = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, fboGaussians);
// Tell WebGL how to convert from clip space to pixels
gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);


// Create a texture for the color buffer.
    const gaussiansColorBuffer = gl.createTexture();

// make unit i the active texture unit
gl.activeTexture(gl.TEXTURE0 + 2);

// Bind texture to 'texture unit i' 2D bind point
gl.bindTexture(gl.TEXTURE_2D, gaussiansColorBuffer);

// Set the parameters so we don't need mips and so we're not filtering
// and we don't repeat
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);


gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.canvas.width, gl.canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
// Bind the texture as where color is going to be written
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, gaussiansColorBuffer, 0);

// Depth
gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, sharedDepthBuffer);






//gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, sharedDepthBuffer, 0);

console.log(gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE)

//Unbind
gl.bindFramebuffer(gl.FRAMEBUFFER, null);



// ------------ Link this buffers to the programs
//gl.useProgram(quadProgram);
//gl.activeTexture(gl.TEXTURE0 + 1);
//gl.uniform1i(u_quadColorTexutre, 1);


// ----------------------------------- End ----------------------------

    const resize = () => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.useProgram(program);
        gl.uniform2fv(u_focal, new Float32Array([camera.fx, camera.fy]));

        projectionMatrix =         getProjectionMatrix(
            camera.fx,
            camera.fy,
            innerWidth,
            innerHeight,
        );

        gl.uniform2fv(u_viewport, new Float32Array([innerWidth, innerHeight]));

        gl.canvas.width = Math.round(innerWidth / downsample);
        gl.canvas.height = Math.round(innerHeight / downsample);
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

        gl.useProgram(program);
        gl.uniformMatrix4fv(u_projection, false, projectionMatrix);
        
        gl.useProgram(cube.Program);
        gl.uniformMatrix4fv(cube.projection, false, projectionMatrix);

        gl.useProgram(quadGaussian.Program);
        gl.uniformMatrix4fv(quadGaussian.Projection, false, projectionMatrix);
        gl.uniform2fv(quadGaussian.Viewport, new Float32Array([gl.canvas.width, gl.canvas.height]));
        gl.useProgram(quadMeshes.Program);
        gl.uniformMatrix4fv(quadMeshes.Projection, false, projectionMatrix);
        gl.uniform2fv(quadMeshes.Viewport, new Float32Array([gl.canvas.width, gl.canvas.height]));


        // -------------------------------- Resize the color buffer
        gl.bindFramebuffer(gl.FRAMEBUFFER, fboMesh);
        // Tell WebGL how to convert from clip space to pixels
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

        // make unit i the active texture unit
        gl.activeTexture(gl.TEXTURE0 + 1);
        gl.bindTexture(gl.TEXTURE_2D, meshColorBuffer);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.canvas.width, gl.canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

        // make unit i the active texture unit
        gl.bindFramebuffer(gl.FRAMEBUFFER, fboGaussians); gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        gl.activeTexture(gl.TEXTURE0 + 2);
        gl.bindTexture(gl.TEXTURE_2D, gaussiansColorBuffer);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.canvas.width, gl.canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

        //Depth
        gl.bindRenderbuffer(gl.RENDERBUFFER, sharedDepthBuffer);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, gl.canvas.width, gl.canvas.height);

        // --------------------- end --------------------
    
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    };

    window.addEventListener("resize", resize);
    resize();

    worker.onmessage = (e) => {

        if (e.data.buffer) {
            splatData = new Uint8Array(e.data.buffer);
            if (e.data.save) {
                const blob = new Blob([splatData.buffer], {
                    type: "application/octet-stream",
                });
                const link = document.createElement("a");
                link.download = "model.splat";
                link.href = URL.createObjectURL(blob);
                document.body.appendChild(link);
                link.click();
            }

        } else if (e.data.texdata) {
            const { texdata, f_buffer, texwidth, texheight } = e.data;
            // console.log(texdata)
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(
                gl.TEXTURE_2D,
                gl.TEXTURE_WRAP_S,
                gl.CLAMP_TO_EDGE,
            );
            gl.texParameteri(
                gl.TEXTURE_2D,
                gl.TEXTURE_WRAP_T,
                gl.CLAMP_TO_EDGE,
            );
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

            gl.texImage2D(
                gl.TEXTURE_2D,
                0,
                gl.RGBA32UI,
                texwidth,
                texheight,
                0,
                gl.RGBA_INTEGER,
                gl.UNSIGNED_INT,
                texdata,
            );
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, texture);

            // Update light sources
            for(let ls of lightSourcesArray){
                ls.updateGaussians(f_buffer, vertexCount);
            }

        } else if (e.data.depthIndex) {
            const { depthIndex, viewProj } = e.data;
            gl.bindBuffer(gl.ARRAY_BUFFER, indexBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, depthIndex, gl.DYNAMIC_DRAW);
            vertexCount = e.data.vertexCount;
            //console.log(depthIndex[0]);


        }
    };

    let activeKeys = [];
    let currentCameraIndex = 0;

    window.addEventListener("keydown", (e) => {
        // if (document.activeElement != document.body) return;
        carousel = false;
        if (!activeKeys.includes(e.code)) activeKeys.push(e.code);
        if (/\d/.test(e.key)) {
            currentCameraIndex = parseInt(e.key);
            camera = cameras[currentCameraIndex];
            viewMatrix = getViewMatrix(camera);
        }
        if (["-", "_"].includes(e.key)) {
            currentCameraIndex =
                (currentCameraIndex + cameras.length - 1) % cameras.length;
            viewMatrix = getViewMatrix(cameras[currentCameraIndex]);
        }
        if (["+", "="].includes(e.key)) {
            currentCameraIndex = (currentCameraIndex + 1) % cameras.length;
            viewMatrix = getViewMatrix(cameras[currentCameraIndex]);
        }
        camid.innerText = "cam  " + currentCameraIndex;
        if (e.code == "KeyV") {
            location.hash =
                "#" +
                JSON.stringify(
                    viewMatrix.map((k) => Math.round(k * 100) / 100),
                );
            camid.innerText = "";
        } else if (e.code === "KeyP") {
            carousel = true;
            camid.innerText = "";
        }
    });
    window.addEventListener("keyup", (e) => {
        activeKeys = activeKeys.filter((k) => k !== e.code);
    });
    window.addEventListener("blur", () => {
        activeKeys = [];
    });

    window.addEventListener(
        "wheel",
        (e) => {
            carousel = false;
            e.preventDefault();
            const lineHeight = 10;
            const scale =
                e.deltaMode == 1
                    ? lineHeight
                    : e.deltaMode == 2
                      ? innerHeight
                      : 1;
            let inv = invert4(viewMatrix);
            if (e.shiftKey) {
                inv = translate4(
                    inv,
                    (e.deltaX * scale) / innerWidth,
                    (e.deltaY * scale) / innerHeight,
                    0,
                );
            } else if (e.ctrlKey || e.metaKey) {
                // inv = rotate4(inv,  (e.deltaX * scale) / innerWidth,  0, 0, 1);
                // inv = translate4(inv,  0, (e.deltaY * scale) / innerHeight, 0);
                // let preY = inv[13];
                inv = translate4(
                    inv,
                    0,
                    0,
                    (-10 * (e.deltaY * scale)) / innerHeight,
                );
                // inv[13] = preY;
            } else {
                let d = 4;
                inv = translate4(inv, 0, 0, d);
                inv = rotate4(inv, -(e.deltaX * scale) / innerWidth, 0, 1, 0);
                inv = rotate4(inv, (e.deltaY * scale) / innerHeight, 1, 0, 0);
                inv = translate4(inv, 0, 0, -d);
            }

            viewMatrix = invert4(inv);
        },
        { passive: false },
    );

    let startX, startY, down;
    canvas.addEventListener("mousedown", (e) => {
        carousel = false;
        e.preventDefault();
        startX = e.clientX;
        startY = e.clientY;
        down = e.ctrlKey || e.metaKey ? 2 : 1;
    });
    canvas.addEventListener("contextmenu", (e) => {
        carousel = false;
        e.preventDefault();
        startX = e.clientX;
        startY = e.clientY;
        down = 2;
    });

    canvas.addEventListener("mousemove", (e) => {
        e.preventDefault();
        if (down == 1) {
            let inv = invert4(viewMatrix);
            let dx = (5 * (e.clientX - startX)) / innerWidth;
            let dy = (5 * (e.clientY - startY)) / innerHeight;
            let d = 4;

            inv = translate4(inv, 0, 0, d);
            inv = rotate4(inv, dx, 0, 1, 0);
            inv = rotate4(inv, -dy, 1, 0, 0);
            inv = translate4(inv, 0, 0, -d);
            // let postAngle = Math.atan2(inv[0], inv[10])
            // inv = rotate4(inv, postAngle - preAngle, 0, 0, 1)
            // console.log(postAngle)
            viewMatrix = invert4(inv);

            startX = e.clientX;
            startY = e.clientY;
        } else if (down == 2) {
            let inv = invert4(viewMatrix);
            // inv = rotateY(inv, );
            // let preY = inv[13];
            inv = translate4(
                inv,
                (-10 * (e.clientX - startX)) / innerWidth,
                0,
                (10 * (e.clientY - startY)) / innerHeight,
            );
            // inv[13] = preY;
            viewMatrix = invert4(inv);

            startX = e.clientX;
            startY = e.clientY;
        }
    });
    canvas.addEventListener("mouseup", (e) => {
        e.preventDefault();
        down = false;
        startX = 0;
        startY = 0;
    });

    let altX = 0,
        altY = 0;
    canvas.addEventListener(
        "touchstart",
        (e) => {
            e.preventDefault();
            if (e.touches.length === 1) {
                carousel = false;
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
                down = 1;
            } else if (e.touches.length === 2) {
                // console.log('beep')
                carousel = false;
                startX = e.touches[0].clientX;
                altX = e.touches[1].clientX;
                startY = e.touches[0].clientY;
                altY = e.touches[1].clientY;
                down = 1;
            }
        },
        { passive: false },
    );
    canvas.addEventListener(
        "touchmove",
        (e) => {
            e.preventDefault();
            if (e.touches.length === 1 && down) {
                let inv = invert4(viewMatrix);
                let dx = (4 * (e.touches[0].clientX - startX)) / innerWidth;
                let dy = (4 * (e.touches[0].clientY - startY)) / innerHeight;

                let d = 4;
                inv = translate4(inv, 0, 0, d);
                // inv = translate4(inv,  -x, -y, -z);
                // inv = translate4(inv,  x, y, z);
                inv = rotate4(inv, dx, 0, 1, 0);
                inv = rotate4(inv, -dy, 1, 0, 0);
                inv = translate4(inv, 0, 0, -d);

                viewMatrix = invert4(inv);

                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
            } else if (e.touches.length === 2) {
                // alert('beep')
                const dtheta =
                    Math.atan2(startY - altY, startX - altX) -
                    Math.atan2(
                        e.touches[0].clientY - e.touches[1].clientY,
                        e.touches[0].clientX - e.touches[1].clientX,
                    );
                const dscale =
                    Math.hypot(startX - altX, startY - altY) /
                    Math.hypot(
                        e.touches[0].clientX - e.touches[1].clientX,
                        e.touches[0].clientY - e.touches[1].clientY,
                    );
                const dx =
                    (e.touches[0].clientX +
                        e.touches[1].clientX -
                        (startX + altX)) /
                    2;
                const dy =
                    (e.touches[0].clientY +
                        e.touches[1].clientY -
                        (startY + altY)) /
                    2;
                let inv = invert4(viewMatrix);
                // inv = translate4(inv,  0, 0, d);
                inv = rotate4(inv, dtheta, 0, 0, 1);

                inv = translate4(inv, -dx / innerWidth, -dy / innerHeight, 0);

                // let preY = inv[13];
                inv = translate4(inv, 0, 0, 3 * (1 - dscale));
                // inv[13] = preY;

                viewMatrix = invert4(inv);

                startX = e.touches[0].clientX;
                altX = e.touches[1].clientX;
                startY = e.touches[0].clientY;
                altY = e.touches[1].clientY;
            }
        },
        { passive: false },
    );
    canvas.addEventListener(
        "touchend",
        (e) => {
            e.preventDefault();
            down = false;
            startX = 0;
            startY = 0;
        },
        { passive: false },
    );

    let jumpDelta = 0;
    let vertexCount = 0;

    let lastFrame = 0;
    let avgFps = 0;
    let start = 0;

    window.addEventListener("gamepadconnected", (e) => {
        const gp = navigator.getGamepads()[e.gamepad.index];
        console.log(
            `Gamepad connected at index ${gp.index}: ${gp.id}. It has ${gp.buttons.length} buttons and ${gp.axes.length} axes.`,
        );
    });
    window.addEventListener("gamepaddisconnected", (e) => {
        console.log("Gamepad disconnected");
    });

    let leftGamepadTrigger, rightGamepadTrigger;

    const frame = (now) => {
        let inv = invert4(viewMatrix);
        let shiftKey =
            activeKeys.includes("Shift") ||
            activeKeys.includes("ShiftLeft") ||
            activeKeys.includes("ShiftRight");

        if (activeKeys.includes("ArrowUp")) {
            if (shiftKey) {
                inv = translate4(inv, 0, -0.03, 0);
            } else {
                inv = translate4(inv, 0, 0, 0.5);
            }
        }
        if (activeKeys.includes("ArrowDown")) {
            if (shiftKey) {
                inv = translate4(inv, 0, 0.03, 0);
            } else {
                inv = translate4(inv, 0, 0, -0.5);
            }
        }
        if (activeKeys.includes("ArrowLeft"))
            inv = translate4(inv, -0.03, 0, 0);
        //
        if (activeKeys.includes("ArrowRight"))
            inv = translate4(inv, 0.03, 0, 0);
        // inv = rotate4(inv, 0.01, 0, 1, 0);
        if (activeKeys.includes("KeyA")) inv = rotate4(inv, -0.01, 0, 1, 0);
        if (activeKeys.includes("KeyD")) inv = rotate4(inv, 0.01, 0, 1, 0);
        if (activeKeys.includes("KeyQ")) inv = rotate4(inv, 0.01, 0, 0, 1);
        if (activeKeys.includes("KeyE")) inv = rotate4(inv, -0.01, 0, 0, 1);
        if (activeKeys.includes("KeyW")) inv = rotate4(inv, 0.005, 1, 0, 0);
        if (activeKeys.includes("KeyS")) inv = rotate4(inv, -0.005, 1, 0, 0);

        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        let isJumping = activeKeys.includes("Space");
        for (let gamepad of gamepads) {
            if (!gamepad) continue;

            const axisThreshold = 0.1; // Threshold to detect when the axis is intentionally moved
            const moveSpeed = 0.06;
            const rotateSpeed = 0.02;

            // Assuming the left stick controls translation (axes 0 and 1)
            if (Math.abs(gamepad.axes[0]) > axisThreshold) {
                inv = translate4(inv, moveSpeed * gamepad.axes[0], 0, 0);
                carousel = false;
            }
            if (Math.abs(gamepad.axes[1]) > axisThreshold) {
                inv = translate4(inv, 0, 0, -moveSpeed * gamepad.axes[1]);
                carousel = false;
            }
            if (gamepad.buttons[12].pressed || gamepad.buttons[13].pressed) {
                inv = translate4(
                    inv,
                    0,
                    -moveSpeed *
                        (gamepad.buttons[12].pressed -
                            gamepad.buttons[13].pressed),
                    0,
                );
                carousel = false;
            }

            if (gamepad.buttons[14].pressed || gamepad.buttons[15].pressed) {
                inv = translate4(
                    inv,
                    -moveSpeed *
                        (gamepad.buttons[14].pressed -
                            gamepad.buttons[15].pressed),
                    0,
                    0,
                );
                carousel = false;
            }

            // Assuming the right stick controls rotation (axes 2 and 3)
            if (Math.abs(gamepad.axes[2]) > axisThreshold) {
                inv = rotate4(inv, rotateSpeed * gamepad.axes[2], 0, 1, 0);
                carousel = false;
            }
            if (Math.abs(gamepad.axes[3]) > axisThreshold) {
                inv = rotate4(inv, -rotateSpeed * gamepad.axes[3], 1, 0, 0);
                carousel = false;
            }

            let tiltAxis = gamepad.buttons[6].value - gamepad.buttons[7].value;
            if (Math.abs(tiltAxis) > axisThreshold) {
                inv = rotate4(inv, rotateSpeed * tiltAxis, 0, 0, 1);
                carousel = false;
            }
            if (gamepad.buttons[4].pressed && !leftGamepadTrigger) {
                camera =
                    cameras[(cameras.indexOf(camera) + 1) % cameras.length];
                inv = invert4(getViewMatrix(camera));
                carousel = false;
            }
            if (gamepad.buttons[5].pressed && !rightGamepadTrigger) {
                camera =
                    cameras[
                        (cameras.indexOf(camera) + cameras.length - 1) %
                            cameras.length
                    ];
                inv = invert4(getViewMatrix(camera));
                carousel = false;
            }
            leftGamepadTrigger = gamepad.buttons[4].pressed;
            rightGamepadTrigger = gamepad.buttons[5].pressed;
            if (gamepad.buttons[0].pressed) {
                isJumping = true;
                carousel = false;
            }
            if (gamepad.buttons[3].pressed) {
                carousel = true;
            }
        }

        if (
            ["KeyJ", "KeyK", "KeyL", "KeyI"].some((k) => activeKeys.includes(k))
        ) {
            let d = 4;
            inv = translate4(inv, 0, 0, d);
            inv = rotate4(
                inv,
                activeKeys.includes("KeyJ")
                    ? -0.05
                    : activeKeys.includes("KeyL")
                      ? 0.05
                      : 0,
                0,
                1,
                0,
            );
            inv = rotate4(
                inv,
                activeKeys.includes("KeyI")
                    ? 0.05
                    : activeKeys.includes("KeyK")
                      ? -0.05
                      : 0,
                1,
                0,
                0,
            );
            inv = translate4(inv, 0, 0, -d);
        }

        viewMatrix = invert4(inv);

        if (carousel) {
            let inv = invert4(defaultViewMatrix);

            const t = Math.sin((Date.now() - start) / 5000);
            inv = translate4(inv, 2.5 * t, 0, 6 * (1 - Math.cos(t)));
            inv = rotate4(inv, -0.6 * t, 0, 1, 0);

            viewMatrix = invert4(inv);
        }

        if (isJumping) {
            jumpDelta = Math.min(1, jumpDelta + 0.05);
        } else {
            jumpDelta = Math.max(0, jumpDelta - 0.05);
        }

        let inv2 = invert4(viewMatrix);
        inv2 = translate4(inv2, 0, -jumpDelta, 0);
        inv2 = rotate4(inv2, -0.1 * jumpDelta, 1, 0, 0);
        let actualViewMatrix = invert4(inv2);

        const viewProj = multiply4(projectionMatrix, actualViewMatrix);
        worker.postMessage({ view: viewProj });

        const currentFps = 1000 / (now - lastFrame) || 0;
        avgFps = avgFps * 0.9 + currentFps * 0.1;

        if (vertexCount > 0) {
            theta += 0.1;
            document.getElementById("spinner").style.display = "none";

            // Render scene in the light sources and create the depth maps
            

            for(let ls of lightSourcesArray) 
            {   
                gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);
                gl.depthMask(true);
                gl.disable(gl.BLEND);
                ls.clean();
                /*
                for(let mesh of meshes)
                {
                    ls.render();
                }*/
                
                ls.render(cube, theta, [1.5, -0.1703, -1.5], 0.1);
                ls.render(cube, theta, [1.5, -0.0, -0.5], 0.5);

                ls.buildShadowsDepthBuffer();
            }
            
            // Render scene

            gl.viewport(0, 0, gl.canvas.width, gl.canvas.height); // The lightmaps resizes the viewport

// -------------- Meshes

            gl.bindFramebuffer(gl.FRAMEBUFFER, fboMesh);

            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);    


            gl.bindVertexArray(cube.VAO);
            gl.useProgram(cube.Program);

            
            gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);
            gl.depthMask(true);
            gl.disable(gl.BLEND);

            gl.uniformMatrix4fv(cube.view, false, actualViewMatrix);

            gl.uniform1f(cube.degrees, theta);
            gl.uniform1f(cube.scale, 0.5);
            gl.uniform3fv(cube.translation, new Float32Array([1.5, -0.0, -0.5]))
            gl.drawElements(gl.TRIANGLES, cube.Indices.length, gl.UNSIGNED_SHORT, 0);

            gl.uniform1f(cube.scale, 0.1);
            gl.uniform3fv(cube.translation, new Float32Array([1.5, -0.1703, -1.5]))
            gl.drawElements(gl.TRIANGLES, cube.Indices.length, gl.UNSIGNED_SHORT, 0);

// ---------------  Gaussians
         
            gl.bindFramebuffer(gl.FRAMEBUFFER, fboGaussians);gl.clear(gl.COLOR_BUFFER_BIT);
  
            gl.bindVertexArray(vao);
            gl.useProgram(program);


            gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);
            //gl.depthFunc(gl.ALWAYS);
            gl.depthMask(false); //No writing
            gl.enable(gl.BLEND);
            gl.blendFuncSeparate(
                gl.ONE_MINUS_DST_ALPHA,
                gl.ONE,
                gl.ONE_MINUS_DST_ALPHA,
                gl.ONE,
            );
            gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
            
            gl.uniformMatrix4fv(u_view, false, actualViewMatrix);
            gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, vertexCount);


            //gl.clear(gl.COLOR_BUFFER_BIT);
            //gl.uniformMatrix4fv(u_view, false, actualViewMatrix);
            //gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, vertexCount);

// -------------------- Quad

            gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.clear(gl.COLOR_BUFFER_BIT);gl.depthMask(true);

            gl.bindVertexArray(vaoQuad);
            

            gl.disable(gl.DEPTH_TEST);
            //gl.enable(gl.BLEND);//
            //gl.disable(gl.BLEND);
            gl.blendFuncSeparate(
                gl.ONE_MINUS_DST_ALPHA, // Source factor for RGB
                gl.DST_ALPHA,           // Destination factor for RGB
                gl.ZERO,                // Source factor for Alpha
                gl.ONE                  // Destination factor for Alpha
            );
            gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);

            //gl.bindFramebuffer(gl.FRAMEBUFFER, null);

            // Render gaussians
            gl.useProgram(quadGaussian.Program);
            gl.uniformMatrix4fv(quadGaussian.View, false, actualViewMatrix);
            gl.uniformMatrix4fv(quadGaussian.LightTrans, false, lightSourcesArray[0].worldToScreen);
            gl.uniform1i(quadGaussian.ImageTex, 2);
            gl.uniform1i(quadGaussian.DepthTex, 7);

            gl.disable(gl.BLEND);
            gl.drawElements(gl.TRIANGLES, quadIndices.length, gl.UNSIGNED_SHORT, 0);



            // Render mesh
            gl.useProgram(quadMeshes.Program);
            gl.uniformMatrix4fv(quadMeshes.View, false, actualViewMatrix);
            gl.uniformMatrix4fv(quadMeshes.LightTrans, false, lightSourcesArray[0].worldToScreen);
            gl.uniform1i(quadMeshes.ImageTex, 1);
            gl.uniform1i(quadMeshes.DepthTex, 7);

            gl.enable(gl.BLEND);
            gl.drawElements(gl.TRIANGLES, quadIndices.length, gl.UNSIGNED_SHORT, 0);
        


            gl.clear(gl.DEPTH_BUFFER_BIT);

            // Clean gaussian buffer
            gl.bindFramebuffer(gl.FRAMEBUFFER, fboGaussians);gl.clear(gl.DEPTH_BUFFER_BIT);

        } else {
            gl.clear(gl.COLOR_BUFFER_BIT);
            document.getElementById("spinner").style.display = "";
            start = Date.now() + 2000;
        }
        const progress = (100 * vertexCount) / (splatData.length / rowLength);
        if (progress < 100) {
            document.getElementById("progress").style.width = progress + "%";
        } else {
            document.getElementById("progress").style.display = "none";
        }
        fps.innerText = Math.round(avgFps) + " fps";
        if (isNaN(currentCameraIndex)) {
            camid.innerText = "";
        }
        lastFrame = now;
        requestAnimationFrame(frame);
    };

    frame();

    const isPly = (splatData) =>
        splatData[0] == 112 &&
        splatData[1] == 108 &&
        splatData[2] == 121 &&
        splatData[3] == 10;

    const selectFile = (file) => {
        const fr = new FileReader();
        if (/\.json$/i.test(file.name)) {
            fr.onload = () => {
                cameras = JSON.parse(fr.result);
                viewMatrix = getViewMatrix(cameras[0]);
                projectionMatrix = getProjectionMatrix(
                    camera.fx / downsample,
                    camera.fy / downsample,
                    canvas.width,
                    canvas.height,
                );
                gl.useProgram(program);
                gl.uniformMatrix4fv(u_projection, false, projectionMatrix);

                gl.useProgram(meshProgram);
                gl.uniformMatrix4fv(mesh_projection, false, projectionMatrix);

                console.log("Loaded Cameras");
            };
            fr.readAsText(file);
        } else {
            stopLoading = true;
            fr.onload = () => {
                splatData = new Uint8Array(fr.result);
                console.log("Loaded", Math.floor(splatData.length / rowLength));

                if (isPly(splatData)) {
                    // ply file magic header means it should be handled differently
                    worker.postMessage({ ply: splatData.buffer, save: true });
                } else {
                    worker.postMessage({
                        buffer: splatData.buffer,
                        vertexCount: Math.floor(splatData.length / rowLength),
                    });
                }
            };
            fr.readAsArrayBuffer(file);
        }
    };

    window.addEventListener("hashchange", (e) => {
        try {
            viewMatrix = JSON.parse(decodeURIComponent(location.hash.slice(1)));
            carousel = false;
        } catch (err) {}
    });

    const preventDefault = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };
    document.addEventListener("dragenter", preventDefault);
    document.addEventListener("dragover", preventDefault);
    document.addEventListener("dragleave", preventDefault);
    document.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectFile(e.dataTransfer.files[0]);
    });

    let bytesRead = 0;
    let lastVertexCount = -1;
    let stopLoading = false;

    while (true) {
        const { done, value } = await reader.read();
        if (done || stopLoading) break;

        splatData.set(value, bytesRead);
        bytesRead += value.length;

        if (vertexCount > lastVertexCount) {
            if (!isPly(splatData)) {
                worker.postMessage({
                    buffer: splatData.buffer,
                    vertexCount: Math.floor(bytesRead / rowLength),
                });
            }
            lastVertexCount = vertexCount;
        }
    }
    if (!stopLoading) {
        if (isPly(splatData)) {
            // ply file magic header means it should be handled differently
            worker.postMessage({ ply: splatData.buffer, save: false });
        } else {
            worker.postMessage({
                buffer: splatData.buffer,
                vertexCount: Math.floor(bytesRead / rowLength),
            });
        }
    }
}

main().catch((err) => {
    document.getElementById("spinner").style.display = "none";
    document.getElementById("message").innerText = err.toString();
});
